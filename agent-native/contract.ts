/** Shared browser/server types only. No framework or server runtime imports. */
import type {Task, Assignment, Candidate, CheckJob, EvidenceReceipt} from '../lib/types';

export const ACTION_NAMES = ['read_context','create_task','claim_task','post_message','update_task','read_workspace','write_workspace','verify_change','read_result'] as const;
export type ActionName = typeof ACTION_NAMES[number];
export type WorkspaceFile = 'README.md'|'summary.mjs'|'summary.test.mjs';
export interface GuardedWrite {operationId:string; taskId:string; taskRevision:number; assignmentId:string; assignmentEpoch:number;}
export interface Inputs {
  read_context: {taskId?:string; after?:number; limit?:number};
  create_task: {operationId:string; goal:string; acceptanceCriteria:string[]; nextAction?:string};
  claim_task: {operationId:string; taskId:string; expectedRevision:number};
  post_message: {operationId:string; body:string; replyToId?:string};
  update_task: {operationId:string; taskId:string; expectedRevision:number; goal?:string; acceptanceCriteria?:string[]; nextAction?:string};
  read_workspace: {taskId:string; file:WorkspaceFile};
  write_workspace: GuardedWrite & {file:'summary.mjs'; content:string};
  verify_change: GuardedWrite & {summary:string};
  read_result: {verificationId:string};
}
export interface SharedMessage {id:string; seq:number; body:string; createdAt:string; sender:Record<string,unknown>; replyToId?:string;}
export interface VerificationSummary {
  verificationId:string; taskId:string; taskRevision:number;
  status:'preparing'|'running'|'passed'|'failed'|'error'|'uncertain';
  proposalId?:string; candidateId?:string; candidateSha?:string; jobId?:string;
  error?:{code:string;message:string};
}
export interface WorkContext {
  project:{id:string;goal:string;revision:number;mode:string;stopped:boolean};
  identity:{id:string;sessionId?:string;kind:string};
  capabilities:string[];
  tasks:Task[]; tasksMore:boolean;
  task:Task|null; assignment:Assignment|null;
  messages:SharedMessage[]; nextCursor:number; messagesMore:boolean;
  workspace:{scope:'check-summary-exercise';files:WorkspaceFile[];editableFiles:['summary.mjs'];checkCommand:string};
  verifications:VerificationSummary[];
  messageConsumption:'not-acknowledged';
}
export interface VerificationResult extends VerificationSummary {
  currentTaskRevision:number|null;
  matchesCurrentRequirements:boolean;
  candidate:Candidate|null; job:CheckJob|null; receipt:EvidenceReceipt|null;
  diff:string; output:string; outputSha256:string|null;
  truncated:{diff:boolean;output:boolean};
  reviewMeaning:'Check evidence is separate from independent review and integration';
}
export interface Outputs {
  read_context:WorkContext;
  create_task:{task:Task};
  claim_task:{assignment:Assignment;task:Task};
  post_message:{message:SharedMessage;duplicate:boolean};
  update_task:{task:Task};
  read_workspace:{file:WorkspaceFile;content:string;sha256:string;taskRevision:number};
  write_workspace:{file:'summary.mjs';sha256:string;bytes:number;taskId:string;taskRevision:number};
  verify_change:VerificationSummary;
  read_result:VerificationResult;
}
export interface ActionError {code:string;message:string;nextAction?:string;currentTaskRevision?:number;verificationId?:string;[key:string]:unknown;}
export type ActionResponse<N extends ActionName=ActionName> = {ok:true;result:Outputs[N]}|{ok:false;error:ActionError};
export const actionPath=(projectId:string,name:ActionName)=>`/api/v1/projects/${encodeURIComponent(projectId)}/agent-native/actions/${name}`;
export const mcpPath=(projectId:string)=>`/api/v1/projects/${encodeURIComponent(projectId)}/agent-native/mcp`;
