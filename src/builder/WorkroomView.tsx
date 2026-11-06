import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, ArrowClockwise, ChatCircle, Clover, FileCode, FileText, GitDiff, PencilSimple, ShieldCheck, WarningCircle } from '@phosphor-icons/react';
import type { SharedMessage, VerificationResult } from '../../agent-native/contract.ts';
import type { Task } from '../../lib/types.ts';
import { acceptanceNotes, DEFAULT_ACCEPTANCE, resultMatchesTask, checkCounts, shortId, shortTime } from './presentation.ts';
import type { StatusTone } from './presentation.ts';

export interface WorkroomViewProps {
  projectId: string; projectTitle: string; tasks: Task[]; tasksMore: boolean;
  task?: Task; messages: SharedMessage[]; messagesMore: boolean;
  assignedName?: string; assignmentStatus: { label: string; tone: StatusTone };
  result: VerificationResult | null; connected: boolean; loading: boolean;
  lastUpdated?: string; busy: string | null; error: string | null; notice: string | null;
  requestDraft: string; setRequestDraft(value: string): void;
  acceptanceDraft: string; setAcceptanceDraft(value: string): void;
  messageDraft: string; setMessageDraft(value: string): void;
  editOpen: boolean; editGoal: string; setEditGoal(value: string): void;
  editAcceptance: string; setEditAcceptance(value: string): void; editRevision?: number;
  openEdit(): void; closeEdit(): void; useCurrentRevision(): void;
  onCreate(): void; onMessage(): void; onUpdate(): void; onRefresh(): void;
  onSelectTask(id: string): void; onMoreMessages(): void;
}

function Diff({ text }: { text: string }) {
  return <pre className="bw-code" aria-label="Exact candidate diff"><code>{text.split('\n').map((line, index) => <span className="bw-diff-line" data-kind={line.startsWith('+') && !line.startsWith('+++') ? 'plus' : line.startsWith('-') && !line.startsWith('---') ? 'minus' : 'context'} key={index}>{line}{'\n'}</span>)}</code></pre>;
}

export function WorkroomView(p: WorkroomViewProps) {
  const [view, setView] = useState<'conversation' | 'result'>('conversation');
  const log = useRef<HTMLUListElement>(null);
  const editInput = useRef<HTMLTextAreaElement>(null);
  const editTrigger = useRef<HTMLButtonElement>(null);
  const previouslyEditing = useRef(false);
  const followLatest = useRef(true);
  const count = p.result?.output ? checkCounts(p.result.output) : null;
  const hasResult = Boolean(p.result?.candidateSha);
  const resultCurrent = p.result ? resultMatchesTask(p.result, p.task) : false;
  const canWrite = p.connected && !p.busy;
  const advanced = `/projects/${encodeURIComponent(`live:${p.projectId}`)}`;
  const candidateLink = p.result?.candidateId ? `${advanced}?kind=candidate&item=${encodeURIComponent(p.result.candidateId)}` : advanced;
  const submit = (event: FormEvent, action: () => void) => { event.preventDefault(); action(); };
  const lastMessageId = p.messages.at(-1)?.id;
  useEffect(() => { if (followLatest.current && log.current) log.current.scrollTop = log.current.scrollHeight; }, [lastMessageId]);
  useEffect(() => { followLatest.current = true; }, [p.task?.id]);
  useEffect(() => {
    if (p.editOpen) editInput.current?.focus();
    else if (previouslyEditing.current) editTrigger.current?.focus();
    previouslyEditing.current = p.editOpen;
  }, [p.editOpen]);

  return <div className="builder-workroom">
    <header className="bw-topbar">
      <a className="bw-brand" href={`/builder?project=${encodeURIComponent(p.projectId)}`} aria-label="Together workroom"><Clover className="bw-brand-mark" weight="fill" size={28} /><span>Together</span></a>
      <span className="bw-project-name">{p.projectTitle || 'Your workroom'}</span>
      <nav className="bw-top-actions" aria-label="Workspace links"><a className="bw-action bw-quiet" href={advanced}>Workspace details <ArrowRight size={15} /></a></nav>
    </header>
    <main className="bw-main">
      <div className="bw-titlebar"><div><p className="bw-eyebrow">A shared place to work</p><h1>{p.task ? 'Here’s where we are.' : 'What should we work on?'}</h1><p className="bw-subtle">Give the crew a direction. Stay part of the conversation.</p></div>
        <div className="bw-connection" role="status"><span className="bw-status-dot" data-connected={p.connected} /><span>{p.loading ? 'Opening your workroom…' : p.connected ? 'Saved workspace connected' : 'Connection unavailable'}</span>{p.lastUpdated && <small>Checked {shortTime(p.lastUpdated)}</small>}</div>
      </div>
      <ol className="bw-journey" aria-label="Work stages">
        <li data-state={p.task ? 'complete' : 'current'}><ChatCircle size={20} /><span>Your request</span></li>
        <li data-state={hasResult ? 'complete' : p.task ? 'current' : 'pending'}><Clover size={20} /><span>The crew’s work</span></li>
        <li data-state={p.task ? 'current' : 'pending'}><PencilSimple size={20} /><span>Your direction</span></li>
        <li data-state={hasResult ? 'current' : 'pending'}><FileCode size={20} /><span>The result</span></li>
      </ol>
      {p.error && <div className="bw-error" role="alert"><WarningCircle size={21} /><div><strong>Let’s check where that stopped.</strong><p>{p.error}</p></div><button className="bw-action bw-secondary" onClick={p.onRefresh} disabled={Boolean(p.busy)}><ArrowClockwise size={17} /> Refresh saved work</button></div>}
      {p.notice && <p className="bw-notice" role="status">{p.notice}</p>}
      {(p.tasks.length > 0 || p.task) && <label className="bw-task-picker">Your work<select value={p.task?.id ?? ''} onChange={e => p.onSelectTask(e.target.value)} disabled={Boolean(p.busy)}><option value="">Start a new request</option>{p.tasks.map(task => <option key={task.id} value={task.id}>{task.goal}</option>)}{p.task && !p.tasks.some(task => task.id === p.task!.id) && <option value={p.task.id}>{p.task.goal}</option>}</select>{p.tasksMore && <small>More saved work is available in Workspace details.</small>}</label>}
      <div className="bw-mobile-tabs" role="group" aria-label="Workroom view"><button type="button" id="bw-conversation-tab" aria-pressed={view === 'conversation'} aria-controls="bw-thread" onClick={() => setView('conversation')}>Conversation</button><button type="button" id="bw-result-tab" aria-pressed={view === 'result'} aria-controls="bw-result" onClick={() => setView('result')}>Result{hasResult ? ' · available' : ''}</button></div>
      <div className="bw-layout" data-view={view}>
        <section className="bw-thread bw-panel" id="bw-thread" aria-label="Conversation and request">
          <div className="bw-panel-heading"><div><p className="bw-eyebrow">You and the crew</p><h2>{p.task ? 'Keep the conversation going.' : 'A small, useful first step.'}</h2></div><ChatCircle size={23} /></div>
          {!p.task ? <form className="bw-composer bw-create" onSubmit={e => submit(e, p.onCreate)}>
            <label htmlFor="bw-request">What would you like the crew to make?</label>
            <textarea id="bw-request" rows={5} maxLength={2000} value={p.requestDraft} onChange={e => p.setRequestDraft(e.target.value)} placeholder="Describe the change you need and what a useful result would look like." required disabled={Boolean(p.busy)} />
            <div className="bw-scope-note"><strong>This workspace starts small.</strong><p>The crew works on a check-summary helper, with edits limited to <code>summary.mjs</code>. It can read the workspace brief and frozen tests, then run the fixed check.</p><ul aria-label="Acceptance notes that will be saved">{acceptanceNotes(p.acceptanceDraft).map((note, index) => <li key={index}>{note}</li>)}</ul></div>
            <details className="bw-detail"><summary>Edit acceptance notes</summary><label htmlFor="bw-acceptance">What should the result do? One point per line.</label><textarea id="bw-acceptance" rows={4} maxLength={8000} value={p.acceptanceDraft} onChange={e => p.setAcceptanceDraft(e.target.value)} disabled={Boolean(p.busy)} /><p className="bw-subtle">Leaving this empty uses the three bounded-workspace defaults shown above.</p></details>
            <div className="bw-composer-actions"><span className="bw-subtle">This saves a real task for your crew. It starts no model by itself.</span><button className="bw-action bw-primary" disabled={!canWrite || !p.requestDraft.trim()} type="submit">{p.busy === 'create' ? 'Saving your request…' : 'Share the request'}<ArrowRight size={17} /></button></div>
          </form> : <>
            <div className="bw-task-summary"><div className="bw-task-meta"><span className="bw-pill" data-tone={p.assignmentStatus.tone}>{p.assignmentStatus.label}</span>{p.assignedName && <span>{p.assignedName}</span>}<span>Brief version {p.task.revision}</span></div><h3>{p.task.goal}</h3>{p.task.nextAction && <p className="bw-subtle"><strong>Next:</strong> {p.task.nextAction}</p>}<details className="bw-detail"><summary>What the brief asks for</summary><ul>{p.task.acceptanceCriteria.map((criterion, i) => <li key={i}>{criterion}</li>)}</ul><p className="bw-subtle">A claim shows who has the task. It does not tell us whether their runtime is working right now.</p></details></div>
            {p.messages.length ? <ul className="bw-messages" ref={log} aria-label="Saved crew messages" onScroll={e => { const el = e.currentTarget; followLatest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
              {p.messages.map(message => <li className="bw-message" data-human={message.sender.mode === 'human'} key={message.id}><div className="bw-message-byline"><strong>{String(message.sender.name ?? 'Crew member')}</strong><time dateTime={message.createdAt}>{shortTime(message.createdAt)}</time></div><p className="bw-message-body">{message.body}</p><details className="bw-message-state"><summary>Message details</summary><span>{message.sender.mode === 'human' ? 'Human' : String(message.sender.runtimeLabel ?? 'Runtime not recorded')}</span><span>Saved message {message.seq}{message.replyToId ? ' · linked reply' : ''}</span></details></li>)}
            </ul> : <div className="bw-empty"><ChatCircle size={30} /><h3>The conversation starts here.</h3><p>Your request is saved. A crew member can read it through the same shared actions.</p></div>}
            {p.messagesMore && <button className="bw-action bw-secondary" onClick={p.onMoreMessages} disabled={Boolean(p.busy)}>Read more saved messages</button>}
            <form className="bw-composer" onSubmit={e => submit(e, p.onMessage)}><label htmlFor="bw-guidance">Add to the conversation</label><textarea id="bw-guidance" rows={3} maxLength={2000} value={p.messageDraft} onChange={e => p.setMessageDraft(e.target.value)} placeholder="Ask a question or leave a note for the crew." disabled={Boolean(p.busy)} /><div className="bw-composer-actions"><button ref={editTrigger} type="button" className="bw-action bw-secondary" onClick={p.openEdit} disabled={!canWrite}><PencilSimple size={17} /> Change the brief</button><button className="bw-action bw-primary" type="submit" disabled={!canWrite || !p.messageDraft.trim()}>{p.busy === 'message' ? 'Saving…' : 'Send message'}<ArrowRight size={17} /></button></div><p className="bw-subtle">Saving a message does not mean an agent has read it. Change the brief when a requirement changes.</p></form>
            {p.editOpen && <form className="bw-composer bw-edit" onSubmit={e => submit(e, p.onUpdate)} aria-label="Change the current brief"><h3>What should change?</h3><p className="bw-subtle">You’re editing version {p.editRevision}. Earlier work stays attached; the agent must read the new version before writing again.</p>{p.editRevision !== p.task.revision && <div className="bw-error" role="alert"><p>The current brief is now version {p.task.revision}. Compare it above with your edit before continuing.</p><button type="button" className="bw-action bw-secondary" onClick={p.useCurrentRevision} disabled={Boolean(p.busy)}>Keep my edit against the current version</button></div>}<label htmlFor="bw-edit-goal">The request</label><textarea ref={editInput} id="bw-edit-goal" rows={3} maxLength={2000} value={p.editGoal} onChange={e => p.setEditGoal(e.target.value)} required disabled={Boolean(p.busy)} /><label htmlFor="bw-edit-acceptance">Acceptance notes · one point per line</label><textarea id="bw-edit-acceptance" rows={4} maxLength={8000} value={p.editAcceptance} onChange={e => p.setEditAcceptance(e.target.value)} disabled={Boolean(p.busy)} /><p className="bw-subtle">If you clear these notes, the workspace defaults below will be used.</p>{!p.editAcceptance.trim() && <ul>{DEFAULT_ACCEPTANCE.map(note => <li key={note}>{note}</li>)}</ul>}<div className="bw-composer-actions"><button type="button" className="bw-action bw-secondary" onClick={p.closeEdit} disabled={Boolean(p.busy)}>Keep the current brief</button><button className="bw-action bw-primary" type="submit" disabled={!canWrite || !p.editGoal.trim()}>{p.busy === 'update' ? 'Saving the brief…' : 'Save updated brief'}<ArrowRight size={17} /></button></div></form>}
          </>}
        </section>
        <section className="bw-result bw-panel" id="bw-result" aria-label="Result and checks">
          <div className="bw-panel-heading"><div><p className="bw-eyebrow">The work you can inspect</p><h2>Here’s the result.</h2></div><GitDiff size={24} /></div>
          {!p.result ? <div className="bw-empty"><FileCode size={34} /><h3>{p.task ? 'No change submitted yet.' : 'Your result will land here.'}</h3><p>{p.task ? 'The exact diff and check output will appear when a crew member submits and verifies a change.' : 'The changed code and what the checks found, linked to the same request.'}</p><span className="bw-pill" data-tone="neutral">Checks not run</span></div> : <div className="bw-result-body">
            <div className="bw-result-state"><span className="bw-pill" data-tone="neutral">{hasResult ? 'Change available' : 'Preparing the change'}</span><span className="bw-pill" data-tone={p.result.status === 'passed' ? 'green' : p.result.status === 'failed' || p.result.status === 'error' ? 'red' : 'amber'}>{p.result.status === 'passed' ? 'Check passed' : p.result.status === 'failed' ? 'Check failed' : p.result.status === 'running' ? 'Check running' : p.result.status === 'preparing' ? 'Check not run yet' : `Check ${p.result.status}`}</span></div>
            {p.result.candidateSha && <p className="bw-subtle">Candidate <code>{shortId(p.result.candidateSha)}</code></p>}
            {!resultCurrent && <div className="bw-error" role="status"><WarningCircle size={20} /><p>This result used brief version {p.result.taskRevision}. The current brief is version {p.task?.revision ?? p.result.currentTaskRevision ?? 'unknown'}. This earlier result is kept; it does not verify the updated request.</p></div>}
            {p.result.error && <p className="bw-error">{p.result.error.message}</p>}
            {count && <p className="bw-result-counts"><strong>{count.passed}</strong> passed <span>·</span> <strong>{count.failed}</strong> failed <span>·</span> {count.total} tests</p>}
            <details className="bw-detail" open><summary>Read the change</summary>{p.result.diff ? <><Diff text={p.result.diff} />{p.result.truncated.diff && <p className="bw-subtle">This preview is partial. Inspect the full candidate before reviewing.</p>}</> : <p className="bw-subtle">The exact diff is not available yet. Your saved work has not been replaced.</p>}</details>
            <details className="bw-detail"><summary>See checks · {p.result.status}</summary>{p.result.job?.command && <p><code>{p.result.job.command}</code></p>}{p.result.output ? <pre className="bw-code" aria-label="Actual check output">{p.result.output}</pre> : <p className="bw-subtle">No check output has been returned yet.</p>}{p.result.truncated.output && <p className="bw-subtle">Only the retained output tail is available here.</p>}{p.result.outputSha256 && <p className="bw-subtle">Output digest <code>{shortId(p.result.outputSha256)}</code></p>}</details>
            <div className="bw-scope-note"><ShieldCheck size={19} /><p>A check is evidence for this version. Independent review and merging are separate.</p><a href={candidateLink}>Open review details <ArrowRight size={15} /></a></div>
          </div>}
          <div className="bw-scope-note"><strong>A small coding workspace</strong><p>This first version works on the check-summary helper. The crew can read its brief and frozen tests, edit <code>summary.mjs</code>, and run the fixed check.</p></div>
        </section>
      </div>
      <footer className="bw-footer"><span>One request. The same work, shared.</span><a href={advanced}>Open the full workspace <ArrowRight size={15} /></a><button className="bw-action bw-quiet" onClick={p.onRefresh} disabled={Boolean(p.busy)}><ArrowClockwise size={15} /> Refresh</button></footer>
    </main>
  </div>;
}
