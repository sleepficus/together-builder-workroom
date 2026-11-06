import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ApiError,fail,json,readJsonBody,requireScope} from '../lib/core.ts';
import {currentMember} from '../lib/conversation.ts';
import {publicJob} from '../lib/checks.ts';
import type {ProjectState} from '../lib/types.ts';
import type {LocalActionBinding,LocalActionSurface} from '../cloud/local-server.ts';
import {CHECK_COMMAND,DEMO_FILES,DEMO_BRIEF,DEMO_TESTS,git,hash,readDemoFile,writeDemoFile} from '../local/demo-workspace.ts';
import type {ActionName,GuardedWrite,VerificationSummary,VerificationResult} from './contract.ts';
import {ACTION_NAMES} from './contract.ts';
import {makeActions,serveMcp} from './actions.mjs';

type Binding=LocalActionBinding;
type Operation={digest:string;actor:string;session:string;phase:'pending'|'complete'|'uncertain';result?:unknown;error?:{code:string;message:string}};
type Verification=VerificationSummary & {createdAt:string;base?:string;head?:string;requirementsHash?:string;actor:string;session:string};
interface Journal {
  version:1;operations:Record<string,Operation>;reads:Record<string,number>;verifications:Record<string,Verification>;
  workspaceBinding?:{taskId:string;assignmentId:string;assignmentEpoch:number};
}
export interface BuilderOptions {projectId:string;repo:string;stateDir:string;checkStateDir:string;}
const scopes:Record<ActionName,string[]>={
  read_context:['read','conversation:read'],create_task:['tasks:write'],claim_task:['tasks:claim'],
  post_message:['conversation:read','conversation:write'],update_task:['tasks:write'],read_workspace:['read'],
  write_workspace:['changes:write'],verify_change:['changes:write','checks:write'],read_result:['read'],
};
function denied(status:number,code:string,message:string,extra:Record<string,unknown>={}):never {
  throw Object.assign(new ApiError(status,code,message,{nextAction:extra.nextAction as string}),extra);
}
function safeError(error:unknown){
  return error instanceof ApiError?{code:error.code,message:error.message}:
    {code:'effect_unconfirmed',message:'The operation did not confirm every step; preserved records require inspection before retry.'};
}
const requirementsHash=(task:{goal:string;acceptanceCriteria:string[]})=>hash(JSON.stringify({goal:task.goal,acceptanceCriteria:task.acceptanceCriteria}));

/** Together remains the authority/store. This journal records only bounded file
 * effects and the staged references into its existing domain records. */
export class BuilderActions implements LocalActionSurface {
  private tail:Promise<unknown>=Promise.resolve();
  private journal:Journal;
  private journalPath:string;
  constructor(private options:BuilderOptions){
    mkdirSync(options.stateDir,{recursive:true,mode:0o700});
    if(lstatSync(options.stateDir).isSymbolicLink())throw Error('Regular private action-state directory required');
    this.journalPath=join(options.stateDir,'action-journal.json');
    this.journal=existsSync(this.journalPath)?JSON.parse(readFileSync(this.journalPath,'utf8')):
      {version:1,operations:{},reads:{},verifications:{}};
    if(this.journal.version!==1||!this.journal.operations||!this.journal.reads||!this.journal.verifications)
      throw Error('Unrecognized action journal; preserve it for recovery');
    // A process interruption is not a failure/no-effect receipt.
    for(const v of Object.values(this.journal.verifications))if(['preparing','running'].includes(v.status))v.status='uncertain';
    this.save();
  }
  private save(){
    const temp=this.journalPath+'.tmp';writeFileSync(temp,JSON.stringify(this.journal,null,2)+'\n',{mode:0o600});
    renameSync(temp,this.journalPath);
  }
  serialize<T>(projectId:string,work:()=>Promise<T>):Promise<T>{
    if(projectId!==this.options.projectId)return work();
    const result=this.tail.then(work);this.tail=result.catch(()=>undefined);return result;
  }
  private async call(b:Binding,path:string,body?:unknown){
    const headers=new Headers();
    for(const key of ['authorization','cookie','x-together-adapter-instance']){
      const value=b.request.headers.get(key);if(value)headers.set(key,value);
    }
    if(body!==undefined)headers.set('content-type','application/json');
    const response=await b.dispatch(new Request(`http://127.0.0.1/api/v1/projects/${encodeURIComponent(b.projectId)}${path}`,
      {method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)}));
    const data=await response.json() as any;
    if(!response.ok)throw new ApiError(response.status,data.error?.code??'upstream_error',data.error?.message??'Project operation failed',data.error);
    return data;
  }
  async authorize(b:Binding,name:ActionName){
    if(b.projectId!==this.options.projectId)fail(404,'not_available','No bounded workspace is configured for this project');
    // Reauthenticate original credentials even if this request waited in queue.
    const fresh=await this.call(b,'/work-context');
    if(fresh.identity?.id!==b.principal.id||fresh.identity?.sessionId!==b.principal.sessionId||!Array.isArray(fresh.capabilities))
      fail(401,'caller_changed','The authenticated caller changed while the request was pending');
    b.principal={...b.principal,scopes:[...fresh.capabilities]};
    const state=await b.store.read();currentMember(state,b.principal);requireScope(b.principal,'read',state);
    for(const scope of scopes[name])requireScope(b.principal,scope,state);
    if(name==='update_task'&&b.principal.kind!=='human')fail(403,'human_requirements','The human owns requirement changes in this entry');
    if(state.stopped&&!['read_context','read_workspace','read_result'].includes(name))fail(409,'project_stopped','Project writes are stopped');
    return state;
  }
  private readKey(b:Binding,taskId:string){return hash([b.projectId,b.principal.id,b.principal.sessionId,taskId].join('\0'));}
  private async guard(b:Binding,args:GuardedWrite){
    const state=await this.authorize(b,'write_workspace'),task=state.tasks[args.taskId];
    if(!task)fail(404,'task_not_found','Task not found');
    if(task.revision!==args.taskRevision)denied(409,'stale_task','The task record changed; reread before writing',
      {currentTaskRevision:task.revision,nextAction:'Call read_context for this task, then reconsider the change against that revision.'});
    if(this.journal.reads[this.readKey(b,task.id)]!==task.revision)denied(409,'context_read_required','Read the current task before changing files',
      {currentTaskRevision:task.revision,nextAction:'Call read_context with this taskId.'});
    const a=state.assignments[args.assignmentId];
    if(!a||a.taskId!==task.id||a.identityId!==b.principal.id||a.sessionId!==b.principal.sessionId||
      a.role!=='owner'||a.status!=='active'||a.epoch!==args.assignmentEpoch||task.currentAssignmentId!==a.id||
      Date.parse(a.leaseExpiresAt)<=Date.parse(b.now())||['done','cancelled'].includes(task.lifecycle))
      fail(409,'assignment_not_current','An active caller-bound owner assignment and epoch are required');
    const bound=this.journal.workspaceBinding;
    if(bound&&bound.taskId!==task.id){const prior=state.assignments[bound.assignmentId];
      if(prior?.status==='active'&&Date.parse(prior.leaseExpiresAt)>Date.parse(b.now()))
        fail(409,'workspace_busy','The bounded workspace is in use by another task');
    }
    return {state,task,assignment:a};
  }
  private frozen(){
    if(readDemoFile(this.options.repo,'README.md')!==DEMO_BRIEF||readDemoFile(this.options.repo,'summary.test.mjs')!==DEMO_TESTS)
      fail(409,'frozen_inputs_changed','Frozen exercise inputs changed; preserve and inspect before continuing');
  }
  private async once(b:Binding,name:ActionName,args:GuardedWrite,run:()=>Promise<unknown>){
    const key=hash(b.projectId+'\0'+args.operationId),digest=hash(JSON.stringify({name,args}));
    const old=this.journal.operations[key];
    if(old){
      if(old.digest!==digest||old.actor!==b.principal.id||old.session!==b.principal.sessionId)
        fail(409,'conflicting_operation','Operation ID already belongs to another request');
      if(old.phase==='complete')return old.result;
      denied(409,'operation_uncertain','This operation has preserved partial evidence; do not blindly repeat it',
        {nextAction:'Inspect read_context/read_result and the private operation record before a new operation.'});
    }
    await this.guard(b,args);
    const op:Operation={digest,actor:b.principal.id,session:b.principal.sessionId,phase:'pending'};
    this.journal.operations[key]=op;this.save();
    try{const result=await run();op.phase='complete';op.result=result;this.save();return result;}
    catch(error){op.phase='uncertain';op.error=safeError(error);this.save();throw error;}
  }
  private summary(v:Verification,state:ProjectState):VerificationSummary{
    const job=v.jobId?state.jobs[v.jobId]:undefined;
    const receipt=job?Object.values(state.receipts).find(r=>r.jobId===job.id):undefined;
    const status=receipt?(receipt.outcome==='pass'?'passed':receipt.outcome==='fail'?'failed':'error'):
      job&&['blocked','failed','cancelled','timed-out'].includes(job.status)?'error':v.status;
    return {verificationId:v.verificationId,taskId:v.taskId,taskRevision:v.taskRevision,status,
      ...(v.proposalId?{proposalId:v.proposalId}:{}),...(v.candidateId?{candidateId:v.candidateId}:{}),
      ...(v.candidateSha?{candidateSha:v.candidateSha}:{}),...(v.jobId?{jobId:v.jobId}:{}),...(v.error?{error:v.error}:{})};
  }
  async execute(b:Binding,name:ActionName,args:any):Promise<unknown>{
    return this.serialize(b.projectId,async()=>{
      const state=await this.authorize(b,name);
      switch(name){
        case 'read_context': {
          const tasks=Object.values(state.tasks).sort((a,c)=>c.updatedAt.localeCompare(a.updatedAt)||c.id.localeCompare(a.id));
          const task=args.taskId?state.tasks[args.taskId]:tasks[0];
          if(args.taskId&&!task)fail(404,'task_not_found','Task not found');
          const page=await this.call(b,`/conversations/team?after=${args.after??0}&limit=${args.limit??5}`);
          if(task){this.journal.reads[this.readKey(b,task.id)]=task.revision;this.save();}
          return {project:{id:state.project.id,goal:state.project.goal,revision:state.project.revision,mode:state.project.mode,stopped:state.stopped},
            identity:{id:b.principal.id,sessionId:b.principal.sessionId,kind:b.principal.kind},capabilities:[...b.principal.scopes],
            tasks:tasks.slice(0,10),tasksMore:tasks.length>10,task:task??null,
            assignment:task?.currentAssignmentId?state.assignments[task.currentAssignmentId]??null:null,
            messages:page.messages,nextCursor:page.nextCursor,messagesMore:page.more,
            workspace:{scope:'check-summary-exercise',files:[...DEMO_FILES],editableFiles:['summary.mjs'],checkCommand:CHECK_COMMAND},
            verifications:Object.values(this.journal.verifications).slice(-5).map(v=>this.summary(v,state)),messageConsumption:'not-acknowledged'};
        }
        case 'create_task':return this.call(b,'/tasks',args);
        case 'claim_task':return this.call(b,`/tasks/${encodeURIComponent(args.taskId)}/assignments`,
          {operationId:args.operationId,expectedRevision:args.expectedRevision,role:'owner'});
        case 'post_message':return this.call(b,'/conversations/team/messages',
          {clientRequestId:args.operationId,body:args.body,...(args.replyToId?{replyToId:args.replyToId}:{})});
        case 'update_task': {const {taskId,...body}=args;return this.call(b,`/tasks/${encodeURIComponent(taskId)}/update`,body);}
        case 'read_workspace': {
          const task=state.tasks[args.taskId];if(!task)fail(404,'task_not_found','Task not found');
          const content=readDemoFile(this.options.repo,args.file);return{file:args.file,content,sha256:hash(content),taskRevision:task.revision};
        }
        case 'write_workspace':return this.once(b,name,args,async()=>{
          this.frozen();if(Buffer.byteLength(args.content)>12000)fail(422,'file_too_large','summary.mjs is limited to 12000 bytes');
          const edits=join(this.options.stateDir,'edits');mkdirSync(edits,{recursive:true,mode:0o700});
          const key=hash(args.operationId),before=readDemoFile(this.options.repo,'summary.mjs');
          writeFileSync(join(edits,key+'.before'),before,{mode:0o600});
          writeFileSync(join(edits,key+'.after'),args.content,{mode:0o600});
          const result=writeDemoFile(this.options.repo,args.file,args.content);
          this.journal.workspaceBinding={taskId:args.taskId,assignmentId:args.assignmentId,assignmentEpoch:args.assignmentEpoch};this.save();
          return {...result,taskId:args.taskId,taskRevision:args.taskRevision};
        });
        case 'verify_change':return this.once(b,name,args,()=>this.verify(b,args));
        case 'read_result':return this.result(state,args.verificationId);
      }
    });
  }
  // Verification substeps persist before the next effect; partial work survives.
  private async verify(b:Binding,args:GuardedWrite & {summary:string}){
    this.frozen();const {task}=await this.guard(b,args),id=randomUUID();
    const v:Verification={verificationId:id,taskId:args.taskId,taskRevision:args.taskRevision,status:'preparing',
      createdAt:b.now(),requirementsHash:requirementsHash(task),actor:b.principal.id,session:b.principal.sessionId};
    this.journal.verifications[id]=v;this.save();
    try{
      const repo=this.options.repo;
      const dirty=git(repo,'status','--porcelain','--untracked-files=all').split('\n').filter(Boolean);
      if(dirty.some(line=>line.trim().slice(2).trim()!=='summary.mjs'))fail(409,'unexpected_workspace_change','Only summary.mjs may change');
      v.base=git(repo,'rev-parse','main');this.save();
      if(git(repo,'diff','HEAD','--','summary.mjs')){
        git(repo,'add','--','summary.mjs');git(repo,'-c','user.name=Together Builder','-c','user.email=builder@local.invalid','commit','-m',`Preserve bounded candidate ${id}`);
      }
      v.head=git(repo,'rev-parse','HEAD');this.save();
      const proposal=await this.call(b,'/changes',{operationId:'builder-proposal-'+id,taskIds:[args.taskId],base:v.base,head:v.head,
        summary:args.summary,intendedBehavior:args.summary,changedPaths:['summary.mjs'],evidenceRefs:[],unknowns:['Independent review and integration have not occurred.']});
      v.proposalId=proposal.proposal.id;this.save();
      const combined=await this.call(b,'/candidates',{operationId:'builder-candidate-'+id,proposalIds:[v.proposalId]});
      v.candidateId=combined.candidate.id;v.candidateSha=combined.candidate.sha;this.save();
      await this.guard(b,args);
      const checked=await this.call(b,`/candidates/${v.candidateId}/checks`,{operationId:'builder-check-'+id,
        expectedRevision:combined.candidate.revision,command:CHECK_COMMAND,timeoutMs:15000,
        assignmentId:args.assignmentId,assignmentEpoch:args.assignmentEpoch});
      v.jobId=checked.job.id;v.status='running';this.save();return this.summary(v,await b.store.read());
    }catch(error){v.status='error';v.error=safeError(error);this.save();
      if(error instanceof ApiError)Object.assign(error,{verificationId:id});throw error;}
  }
  private result(state:ProjectState,id:string):VerificationResult{
    const v=this.journal.verifications[id];if(!v)fail(404,'verification_not_found','Verification not found');
    const candidate=v.candidateId?state.candidates[v.candidateId]??null:null;
    const rawJob=v.jobId?state.jobs[v.jobId]:null;
    // Use public job projection: collector hashes are private authority material.
    const job=rawJob?publicJob(rawJob) as any:null;
    const receipt=rawJob?Object.values(state.receipts).find(r=>r.jobId===rawJob.id)??null:null;
    let output='',outputSha256:string|null=null;
    const path=v.jobId?join(this.options.checkStateDir,'checks',v.jobId,'result.json'):null;
    if(path&&existsSync(path)){
      const check=JSON.parse(readFileSync(path,'utf8'));
      if(check.jobId!==v.jobId||check.candidateSha!==v.candidateSha||check.outputHash!==hash(check.output)||
        (receipt?.outputHash&&receipt.outputHash!==check.outputHash))fail(409,'check_evidence_mismatch','Saved output does not match its check receipt');
      output=check.output;outputSha256=check.outputHash;
    }
    const diff=candidate&&v.base?git(this.options.repo,'diff',v.base,candidate.sha,'--','summary.mjs'):'';
    const revision=state.tasks[v.taskId]?.revision??null;
    const matchesCurrentRequirements=Boolean(v.requirementsHash&&state.tasks[v.taskId]&&requirementsHash(state.tasks[v.taskId])===v.requirementsHash);
    return {...this.summary(v,state),currentTaskRevision:revision,matchesCurrentRequirements,
      candidate,job,receipt,diff:diff.slice(0,16000),output:output.slice(0,32000),outputSha256,
      truncated:{diff:diff.length>16000,output:output.length>32000},
      reviewMeaning:'Check evidence is separate from independent review and integration'};
  }
  async fetch(request:Request,b:Binding):Promise<Response>{
    try{
      await this.authorize(b,'read_result');
      const actions=makeActions(this,b),tail=new URL(request.url).pathname.split('/agent-native/')[1];
      if(tail==='mcp')return await serveMcp(request,actions);
      if(request.method!=='POST')fail(405,'method_not_allowed','Actions require POST');
      const name=tail?.startsWith('actions/')?tail.slice(8):'';
      if(!(ACTION_NAMES as readonly string[]).includes(name))fail(404,'action_not_found','Unknown action');
      const body=await readJsonBody(request,32000);
      if(Object.keys(body).some(k=>k!=='args'))fail(422,'invalid_body','Action request contains only args');
      return json(200,await actions[name].run(body.args??{},{caller:'frontend',actionName:name}));
    }catch(error){
      const e=error as any;
      if(error instanceof ApiError)return json(error.status,{ok:false,error:{...safeError(error),
        ...(error.nextAction?{nextAction:error.nextAction}:{}),...(e.currentTaskRevision?{currentTaskRevision:e.currentTaskRevision}:{}),
        ...(e.verificationId?{verificationId:e.verificationId}:{})}});
      if(e.name==='ZodError'||Array.isArray(e.issues)||String(e.message).startsWith('Invalid action parameters'))return json(422,{ok:false,error:{code:'invalid_arguments',message:'Arguments do not match the action schema'}});
      return json(500,{ok:false,error:{code:'internal_error',message:'Action failed; private evidence is preserved'}});
    }
  }
}
