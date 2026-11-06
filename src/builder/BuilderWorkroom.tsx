import { useCallback, useEffect, useRef, useState } from 'react';
import type { Assignment } from '../../lib/types.ts';
import type { SharedMessage, VerificationResult, WorkContext } from '../../agent-native/contract.ts';
import { BuilderActionError, callBuilderAction, operationFor } from './action-client.ts';
import { acceptanceNotes, DEFAULT_ACCEPTANCE, assignmentLabel, describeError, shortId } from './presentation.ts';
import { LeaseClock, useLeaseTime } from '../ui/lease-clock.tsx';
import { WorkroomView } from './WorkroomView.tsx';
import type { WorkroomViewProps } from './WorkroomView.tsx';

const DEFAULT_PROJECT = 'builder-demo'; // Declared start:builder seed; not a discovered private project.
const storageKey = (project: string, kind: string, task = 'new') => `together.builder.${project}.${task}.${kind}`;
function readDraft<T>(key: string, fallback: T): T {
  try { const value = sessionStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}
function saveDraft(key: string, value: unknown) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Editing still works without browser storage. */ } }
function clearDraft(key: string) { try { sessionStorage.removeItem(key); } catch { /* No storage requirement. */ } }
type PendingOperation = { signature: string; id: string } | undefined;
type EditDraft = { goal: string; acceptance: string; revision: number };
type RequestRecovery = { taskId: string; body: string; operationId: string; createOperationId: string; acceptanceDraft: string };

function CurrentWorkroom({ assignment, ...props }: Omit<WorkroomViewProps, 'assignmentStatus'> & { assignment: Assignment | null }) {
  const now = useLeaseTime();
  return <WorkroomView {...props} assignmentStatus={props.task ? assignmentLabel(props.task, assignment ?? undefined, now) : { label: 'No task yet', tone: 'neutral' }} />;
}

export default function BuilderWorkroom() {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const [projectId] = useState(() => params.get('project')?.trim() || DEFAULT_PROJECT);
  const [taskId, setTaskId] = useState<string | undefined>(() => params.get('task') || undefined);
  const [context, setContext] = useState<WorkContext | null>(null);
  const [messages, setMessages] = useState<SharedMessage[]>([]);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>();
  const [busy, setBusy] = useState<string | null>(null);
  const [requestDraft, setRequest] = useState(() => readDraft(storageKey(projectId, 'request'), ''));
  const [acceptanceDraft, setAcceptance] = useState(() => readDraft(storageKey(projectId, 'acceptance'), DEFAULT_ACCEPTANCE.join('\n')));
  const [messageDraft, setMessage] = useState(() => readDraft(storageKey(projectId, 'message', taskId), ''));
  const [editOpen, setEditOpen] = useState(false);
  const [edit, setEdit] = useState<EditDraft>({ goal: '', acceptance: '', revision: 0 });
  const [requestRecovery, setRequestRecovery] = useState<RequestRecovery | null>(() => readDraft(storageKey(projectId, 'request-recovery'), null));
  const createOperation = useRef<PendingOperation>(readDraft(storageKey(projectId, 'create-operation'), undefined));
  const messageOperation = useRef<PendingOperation>(readDraft(storageKey(projectId, 'message-operation', taskId), undefined));
  const updateOperation = useRef<PendingOperation>(readDraft(storageKey(projectId, 'update-operation', taskId), undefined));
  const cursor = useRef(0);
  const selectedTask = useRef(taskId);
  const busyRef = useRef(false);
  const refreshRef = useRef<() => void>(() => undefined);
  const task = taskId ? context && context.task?.id === taskId ? context.task : context?.tasks.find(row => row.id === taskId) : undefined;

  const setRequestDraft = (value: string) => { setRequest(value); saveDraft(storageKey(projectId, 'request'), value); };
  const setAcceptanceDraft = (value: string) => { setAcceptance(value); saveDraft(storageKey(projectId, 'acceptance'), value); };
  const setMessageDraft = (value: string) => { setMessage(value); saveDraft(storageKey(projectId, 'message', taskId), value); };
  const updateEdit = (next: EditDraft) => { setEdit(next); saveDraft(storageKey(projectId, 'edit', taskId), next); };

  const chooseTask = useCallback((id: string) => {
    selectedTask.current = id || undefined;
    setTaskId(id || undefined);
    setResult(null); setEditOpen(false); setActionError(null); setNotice(null);
    setMessage(readDraft(storageKey(projectId, 'message', id || undefined), ''));
    messageOperation.current = readDraft(storageKey(projectId, 'message-operation', id || undefined), undefined);
    updateOperation.current = readDraft(storageKey(projectId, 'update-operation', id || undefined), undefined);
    const query = new URLSearchParams(window.location.search);
    query.set('project', projectId);
    if (id) query.set('task', id); else query.delete('task');
    window.history.replaceState({}, '', `/builder?${query.toString()}`);
  }, [projectId]);

  useEffect(() => {
    let stopped = false, inFlight = false, timer: ReturnType<typeof setTimeout>;
    let abort: AbortController | null = null;
    cursor.current = 0;
    setMessages([]); setLoading(true); setResult(null);
    const load = async () => {
      if (stopped || inFlight) return;
      clearTimeout(timer); inFlight = true;
      abort = new AbortController();
      try {
        const snapshot = await callBuilderAction(projectId, 'read_context', { ...(taskId ? { taskId } : {}), after: cursor.current, limit: 10 }, abort.signal);
        if (stopped) return;
        setContext(snapshot);
        cursor.current = snapshot.nextCursor;
        setMessages(prior => [...new Map([...prior, ...snapshot.messages].map(message => [message.id, message])).values()].sort((a, b) => a.seq - b.seq));
        const verification = snapshot.verifications.filter(row => row.taskId === taskId).at(-1);
        if (verification) {
          const actual = await callBuilderAction(projectId, 'read_result', { verificationId: verification.verificationId }, abort.signal);
          if (stopped) return;
          setResult(actual);
        } else setResult(null);
        setConnected(true); setReadError(null); setLastUpdated(new Date().toISOString());
      } catch (error) {
        if (stopped || abort?.signal.aborted) return;
        setConnected(false);
        setReadError(error instanceof BuilderActionError && error.status === 401 ? 'Your workspace session needs to be reopened. Use local login; your saved work is kept.' : describeError(error));
      } finally {
        inFlight = false;
        if (!stopped) { setLoading(false); timer = setTimeout(load, document.hidden ? 30000 : 2500); }
      }
    };
    refreshRef.current = () => { void load(); };
    const visible = () => { if (!document.hidden) void load(); };
    void load(); document.addEventListener('visibilitychange', visible);
    return () => { stopped = true; clearTimeout(timer); abort?.abort(); document.removeEventListener('visibilitychange', visible); };
  }, [projectId, taskId]);

  useEffect(() => {
    const onPop = () => chooseTask(new URLSearchParams(window.location.search).get('task') ?? '');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [chooseTask]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (busyRef.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  async function mutation(name: string, work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(name); setActionError(null); setNotice(null);
    try { await work(); }
    catch (error) { setActionError(describeError(error)); }
    finally { busyRef.current = false; setBusy(null); refreshRef.current(); }
  }

  async function finishRequest(recovery: RequestRecovery) {
    await callBuilderAction(projectId, 'post_message', { operationId: recovery.operationId, body: recovery.body });
    clearDraft(storageKey(projectId, 'request-recovery')); setRequestRecovery(null);
    if (readDraft(storageKey(projectId, 'request'), '') === recovery.body && readDraft(storageKey(projectId, 'acceptance'), DEFAULT_ACCEPTANCE.join('\n')) === recovery.acceptanceDraft) {
      setRequestDraft(''); setAcceptanceDraft(DEFAULT_ACCEPTANCE.join('\n'));
    }
    if (createOperation.current?.id === recovery.createOperationId) {
      createOperation.current = undefined;
      clearDraft(storageKey(projectId, 'create-operation'));
    }
    setNotice('Your request and task are saved. A connected crew member can pick up this work.');
  }

  const onCreate = () => void mutation('create', async () => {
    if (requestRecovery) throw new Error('Finish confirming the earlier request message first. Your new draft is kept.');
    const goal = requestDraft;
    if (!goal.trim()) return;
    const acceptanceCriteria = acceptanceNotes(acceptanceDraft);
    const signature = JSON.stringify({ goal, acceptanceCriteria });
    createOperation.current = operationFor(createOperation.current, signature);
    saveDraft(storageKey(projectId, 'create-operation'), createOperation.current);
    const operation = createOperation.current;
    const saved = await callBuilderAction(projectId, 'create_task', { operationId: operation.id, goal, acceptanceCriteria });
    const recovery = { taskId: saved.task.id, body: goal, operationId: `${operation.id}:original-request`, createOperationId: operation.id, acceptanceDraft };
    saveDraft(storageKey(projectId, 'request-recovery'), recovery); setRequestRecovery(recovery);
    chooseTask(saved.task.id);
    await finishRequest(recovery);
  });

  const onMessage = () => void mutation('message', async () => {
    const body = messageDraft;
    if (!body.trim()) return;
    messageOperation.current = operationFor(messageOperation.current, JSON.stringify({ taskId, body }));
    saveDraft(storageKey(projectId, 'message-operation', taskId), messageOperation.current);
    await callBuilderAction(projectId, 'post_message', { operationId: messageOperation.current.id, body });
    const key = storageKey(projectId, 'message', taskId);
    if (readDraft(key, '') === body) {
      clearDraft(key);
      if (selectedTask.current === taskId) setMessage('');
    }
    messageOperation.current = undefined;
    clearDraft(storageKey(projectId, 'message-operation', taskId));
    setNotice('Message saved. This does not claim that a crew member has read it yet.');
  });

  const onUpdate = () => void mutation('update', async () => {
    if (!taskId || !edit.goal.trim()) return;
    const args = { taskId, expectedRevision: edit.revision, goal: edit.goal, acceptanceCriteria: acceptanceNotes(edit.acceptance) };
    updateOperation.current = operationFor(updateOperation.current, JSON.stringify(args));
    saveDraft(storageKey(projectId, 'update-operation', taskId), updateOperation.current);
    const saved = await callBuilderAction(projectId, 'update_task', { operationId: updateOperation.current.id, ...args });
    setEditOpen(false); clearDraft(storageKey(projectId, 'edit', taskId)); updateOperation.current = undefined;
    clearDraft(storageKey(projectId, 'update-operation', taskId));
    setNotice(`Brief version ${saved.task.revision} is saved. The crew must read the new version before writing or verifying this task again.`);
  });

  const openEdit = () => {
    if (!task) return;
    setEdit(readDraft(storageKey(projectId, 'edit', task.id), { goal: task.goal, acceptance: task.acceptanceCriteria.join('\n'), revision: task.revision }));
    setEditOpen(true);
  };
  const closeEdit = () => { setEditOpen(false); clearDraft(storageKey(projectId, 'edit', taskId)); };
  const assignment = context && taskId && context.task?.id === taskId ? context.assignment : null;
  const participant = assignment ? messages.find(message => message.sender.id === assignment.identityId)?.sender.name : undefined;
  const assignedName = assignment ? typeof participant === 'string' ? participant : `Crew member ${shortId(assignment.identityId)}` : undefined;

  return <>
    {!connected && !loading && <div className="builder-workroom bw-login-hint"><a href="/local-login">Reopen local login</a><span> · Sign-in stays on this computer.</span></div>}
    {requestRecovery && <div className="builder-workroom bw-recovery"><p>The task was saved. Its original message still needs confirmation.</p><button className="bw-action bw-secondary" onClick={() => void mutation('create', () => finishRequest(requestRecovery))} disabled={!connected || Boolean(busy)}>Finish saving the original request</button></div>}
    <LeaseClock state={{ assignments: assignment ? { [assignment.id]: assignment } : {} }} mode="live">
      <CurrentWorkroom projectId={projectId} projectTitle={context?.project.goal ?? 'Together workroom'} tasks={context?.tasks ?? []} tasksMore={context?.tasksMore ?? false} task={task} messages={messages} messagesMore={context?.messagesMore ?? false} assignment={assignment} assignedName={assignedName} result={result} connected={connected} loading={loading} lastUpdated={lastUpdated} busy={busy} error={actionError ?? readError} notice={notice} requestDraft={requestDraft} setRequestDraft={setRequestDraft} acceptanceDraft={acceptanceDraft} setAcceptanceDraft={setAcceptanceDraft} messageDraft={messageDraft} setMessageDraft={setMessageDraft} editOpen={editOpen} editGoal={edit.goal} setEditGoal={goal => updateEdit({ ...edit, goal })} editAcceptance={edit.acceptance} setEditAcceptance={acceptance => updateEdit({ ...edit, acceptance })} editRevision={edit.revision} openEdit={openEdit} closeEdit={closeEdit} useCurrentRevision={() => { if (task) updateEdit({ ...edit, revision: task.revision }); }} onCreate={onCreate} onMessage={onMessage} onUpdate={onUpdate} onRefresh={() => { setActionError(null); refreshRef.current(); }} onSelectTask={chooseTask} onMoreMessages={() => refreshRef.current()} />
    </LeaseClock>
  </>;
}
