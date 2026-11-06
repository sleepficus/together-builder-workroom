import assert from 'node:assert/strict';
import test from 'node:test';
import { callBuilderAction, BuilderActionError, operationFor } from './action-client.ts';
import { acceptanceNotes, DEFAULT_ACCEPTANCE, resultMatchesTask, checkCounts, assignmentLabel } from './presentation.ts';
import type { Assignment, Task } from '../../lib/types.ts';
import type { VerificationResult } from '../../agent-native/contract.ts';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import BuilderWorkroom from './BuilderWorkroom.tsx';

async function fakeFetch(run: typeof fetch, work: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = run;
  try { await work(); } finally { globalThis.fetch = original; }
}

test('human bridge sends typed args with the browser cookie and unchanged operation ID', async () => {
  await fakeFetch(async (url, init) => {
    assert.equal(url, '/api/v1/projects/project%2Fa/agent-native/actions/create_task');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(String(init?.body)), { args: { operationId: 'original-operation', goal: 'Keep my exact request', acceptanceCriteria: [] } });
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return Response.json({ ok: true, result: { task: { id: 'actual-task' } } });
  }, async () => {
    const result = await callBuilderAction('project/a', 'create_task', { operationId: 'original-operation', goal: 'Keep my exact request', acceptanceCriteria: [] });
    assert.equal(result.task.id, 'actual-task');
  });
});

test('stale writes preserve the structured refusal and are never automatically replayed', async () => {
  let calls = 0;
  await fakeFetch(async () => {
    calls++;
    return Response.json({ ok: false, error: { code: 'stale_context', message: 'Read the changed brief first.', currentTaskRevision: 4 } }, { status: 409 });
  }, async () => {
    await assert.rejects(callBuilderAction('project', 'update_task', { operationId: 'same-proposal', taskId: 'task', expectedRevision: 2, goal: 'My retained edit' }), error => error instanceof BuilderActionError && error.code === 'stale_context' && error.details?.currentTaskRevision === 4);
    assert.equal(calls, 1);
  });
});

test('an unknown transport outcome supplies a recovery message rather than a retry', async () => {
  let calls = 0;
  await fakeFetch(async () => { calls++; throw new TypeError('network offline'); }, async () => {
    await assert.rejects(callBuilderAction('project', 'post_message', { operationId: 'retained-id', body: 'My note' }), error => error instanceof BuilderActionError && error.code === 'connection_unavailable' && error.status === 0);
    assert.equal(calls, 1);
  });
});

test('an HTML or truncated response is not treated as a successful action', async () => {
  await fakeFetch(async () => new Response('<html>sign in</html>'), async () => {
    await assert.rejects(callBuilderAction('project', 'read_context', {}), error => error instanceof BuilderActionError && error.code === 'invalid_response');
  });
});

test('a failure envelope remains a failure even if a proxy returns HTTP 200', async () => {
  await fakeFetch(async () => Response.json({ ok: false, error: { code: 'forbidden', message: 'This project is outside the grant.' } }), async () => {
    await assert.rejects(callBuilderAction('project', 'read_context', {}), error => error instanceof BuilderActionError && error.code === 'forbidden');
  });
});

test('cancelled reads retain their abort outcome', async () => {
  const abort = new AbortController();
  abort.abort();
  await fakeFetch(async () => { throw new DOMException('Aborted', 'AbortError'); }, async () => {
    await assert.rejects(callBuilderAction('project', 'read_context', {}, abort.signal), error => error instanceof DOMException && error.name === 'AbortError');
  });
});

test('one unchanged proposal retains its ID while a changed proposal gets a new one', () => {
  const original = operationFor(undefined, 'first payload');
  assert.equal(operationFor(original, 'first payload'), original);
  assert.notEqual(operationFor(original, 'changed payload').id, original.id);
});

test('only actual TAP totals are displayed; a missing result remains unknown', () => {
  assert.deepEqual(checkCounts('TAP version 13\n# tests 10\n# pass 9\n# fail 1\n'), { total: 10, passed: 9, failed: 1 });
  assert.equal(checkCounts('The model says all tests passed.'), null);
  assert.equal(checkCounts('# tests 10\n# pass 9\n'), null);
});

test('the shared RC3 claim classifier keeps expired recorded-active claims out of the Assigned display', () => {
  const task = { id: 'task', currentAssignmentId: 'claim' } as Task;
  const assignment = { id: 'claim', taskId: 'task', role: 'owner', status: 'active', leaseExpiresAt: '2026-10-27T10:00:00Z' } as Assignment;
  const before = JSON.stringify(assignment);
  assert.equal(assignmentLabel(task, assignment, Date.parse('2026-10-27T10:00:01Z')).label, 'Claim expired · work kept');
  assert.equal(JSON.stringify(assignment), before);
  assignment.leaseExpiresAt = 'not-recorded';
  assert.equal(assignmentLabel(task, assignment).label, 'Claim timing unknown');
});

test('the first render has a usable empty workroom rather than inventing a task or dereferencing missing context', () => {
  const html = renderToStaticMarkup(createElement(BuilderWorkroom));
  assert.match(html, /What should we work on/);
  assert.match(html, /Share the request/);
  assert.match(html, /Opening your workroom/);
  assert.match(html, /Acceptance notes that will be saved/);
  assert.match(html, /Edit only summary.mjs/);
  assert.doesNotMatch(html, /Claimed by|Working now|Check passed/);
});

test('prompt-only and cleared-note edits use the same explicit bounded defaults shown in the UI', () => {
  assert.deepEqual(acceptanceNotes(''), [...DEFAULT_ACCEPTANCE]);
  assert.deepEqual(acceptanceNotes(' \n\n'), [...DEFAULT_ACCEPTANCE]);
  assert.deepEqual(acceptanceNotes('My stated requirement\nSecond point'), ['My stated requirement', 'Second point']);
});

test('a retained passed result cannot verify a newer displayed brief after its refresh fails', () => {
  const retained = { taskId: 'task', taskRevision: 2, currentTaskRevision: 2, matchesCurrentRequirements: true, status: 'passed' } as VerificationResult;
  assert.equal(resultMatchesTask(retained, { id: 'task', revision: 2 } as Task), true);
  assert.equal(resultMatchesTask(retained, { id: 'task', revision: 3 } as Task), false);
  assert.equal(resultMatchesTask(retained, { id: 'another-task', revision: 2 } as Task), false);
  assert.equal(resultMatchesTask(retained, undefined), false);
});
