/** Browser transport only. The server owns the shared Agent-Native action objects. */
import { actionPath } from '../../agent-native/contract.ts';
import type { ActionName, Inputs, Outputs } from '../../agent-native/contract.ts';
export class BuilderActionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BuilderActionError';
  }
}

export async function callBuilderAction<N extends ActionName>(
  projectId: string,
  name: N,
  args: Inputs[N],
  signal?: AbortSignal,
): Promise<Outputs[N]> {
  const url = actionPath(projectId, name);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new BuilderActionError('connection_unavailable', 'The connection stopped responding. Your saved work is still there; refresh before sending again.', 0);
  }
  let body: any;
  try { body = await response.json(); }
  catch {
    throw new BuilderActionError('invalid_response', 'The workspace returned an unreadable response. Refresh to check what was saved before trying again.', response.status);
  }
  if (!response.ok || body?.ok !== true) {
    const error = body?.error ?? {};
    throw new BuilderActionError(
      typeof error.code === 'string' ? error.code : 'action_failed',
      typeof error.message === 'string' ? error.message : 'That action did not finish. Your other work has been kept.',
      response.status,
      error,
    );
  }
  return body.result as Outputs[N];
}

/** Retain the ID for the same unchanged proposal, including uncertain responses. */
export function operationFor(
  pending: { signature: string; id: string } | undefined,
  signature: string,
): { signature: string; id: string } {
  return pending?.signature === signature ? pending : { signature, id: crypto.randomUUID() };
}
