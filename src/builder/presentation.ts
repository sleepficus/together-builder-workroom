import type { Assignment, Task } from '../../lib/types.ts';
import { claimState } from '../ui/Inspector.tsx';
import type { VerificationResult } from '../../agent-native/contract.ts';

export type StatusTone = 'neutral' | 'green' | 'amber' | 'red';
export const DEFAULT_ACCEPTANCE = [
  'Follow the saved request within this check-summary exercise.',
  'Edit only summary.mjs; keep the workspace brief and frozen tests unchanged.',
  'Run the fixed check and report its actual result.',
] as const;
export function acceptanceNotes(value: string): string[] {
  const notes = value.split('\n').map(line => line.trim()).filter(Boolean);
  return notes.length ? notes : [...DEFAULT_ACCEPTANCE];
}

export function resultMatchesTask(result: VerificationResult, task?: Task): boolean {
  return Boolean(task && result.taskId === task.id && result.taskRevision === task.revision && result.matchesCurrentRequirements);
}

/** A claim is a coordination fact, never evidence that model inference is active. */
export function assignmentLabel(task: Task, assignment?: Assignment, now = Date.now()): { label: string; tone: StatusTone } {
  if (!assignment) return { label: 'Waiting for a crew member', tone: 'neutral' };
  const state = claimState({ tasks: { [task.id]: task } }, 'live', assignment, now);
  if (state === 'expired') return { label: 'Claim expired · work kept', tone: 'amber' };
  if (state === 'prior') return { label: 'Previous claim · work kept', tone: 'neutral' };
  if (state === 'unknown') return { label: 'Claim timing unknown', tone: 'amber' };
  return { label: 'Assigned', tone: 'neutral' };
}

export function checkCounts(output: string): { total: number; passed: number; failed: number } | null {
  const number = (name: string) => {
    const match = output.match(new RegExp(`^# ${name} (\\d+)\\s*$`, 'm'));
    return match ? Number(match[1]) : null;
  };
  const total = number('tests'), passed = number('pass'), failed = number('fail');
  return total === null || passed === null || failed === null ? null : { total, passed, failed };
}

export function shortTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unknown' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function shortId(value?: string): string { return value ? value.slice(0, 12) : 'Not recorded'; }

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'That action did not finish. Refresh to check your saved work.';
}
