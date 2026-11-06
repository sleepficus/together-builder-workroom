import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalApi} from '../cloud/local-server.ts';
import {BuilderActions} from '../agent-native/server.ts';
import {ensureWorkspace,CHECK_COMMAND,fixedDemoRunner,hash,git} from '../local/demo-workspace.ts';
import {hashToken} from '../lib/identity.ts';
import {ACTION_NAMES} from '../agent-native/contract.ts';
import {builderCookieName} from '../scripts/start-local.mts';

const scopes=['read','conversation:read','conversation:write','tasks:write','tasks:claim','tasks:progress','changes:write','checks:write'];
const solution=`export function summarizeChecks(records) {
 const rows=Array.isArray(records)?records:[];
 const passed=rows.filter(r=>r?.status==='passed').length;
 const failed=rows.filter(r=>r?.status==='failed').length;
 return {status:failed?'failed':rows.length&&passed===rows.length?'passed':'not-checked',total:rows.length,passed,failed,notChecked:rows.length-passed-failed};
}\n`;
async function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'builder-actions-')),repo=ensureWorkspace(dir),checkDir=join(dir,'results');
  let time=new Date().toISOString();
  const boot=()=>createLocalApi({ownerTokens:[{ownerId:'owner',token:'fixture-owner'}],seedProjects:[{id:'builder-demo',goal:'Fixture project'}],
    sessionCookieName:builderCookieName(dir),
    stateDir:join(dir,'api'),gitRepo:repo,gitProjectId:'builder-demo',defaultCheckCommand:CHECK_COMMAND,
    agentNative:new BuilderActions({projectId:'builder-demo',repo,stateDir:join(dir,'actions'),checkStateDir:checkDir}),
    now:()=>time,runnerFactory:collector=>fixedDemoRunner(repo,checkDir,collector,()=>{})});
  let api=boot();
  const store=api.storeFor('builder-demo')!;
  for(const id of ['a','b']){
    const tokenHash=await hashToken('fixture-'+id);
    await store.transact(s=>{const e={projectId:'builder-demo',revision:1,createdAt:time,updatedAt:time,actorId:'owner'};
      s.identities[id]={...e,id,displayName:'Test '+id,ownerId:'owner',creationSource:'fixture',status:'active'};
      s.sessions[id+'s']={...e,id:id+'s',identityId:id,status:'active',harness:'synthetic fixture client',model:'no model called',advertisedCapabilities:[],observedCapabilities:[]};
      s.members[id]={...e,id,identityId:id,kind:'core',scopes:[...scopes]};
      s.credentials[id+'c']={...e,id:id+'c',identityId:id,sessionId:id+'s',projectIds:['builder-demo'],tokenHash,status:'active',scopes:[...scopes],expiresAt:new Date(Date.now()+86400000).toISOString()};
    });
  }
  const raw=async(actor:string,path:string,body?:unknown,extra:Record<string,string>={})=>{
    const response=await api.fetch(new Request('http://127.0.0.1/api/v1/projects/builder-demo'+path,
      {method:body===undefined?'GET':'POST',headers:{authorization:'Bearer fixture-'+actor,...extra},body:body===undefined?undefined:JSON.stringify(body)}));
    return{status:response.status,body:await response.json() as any};
  };
  await raw('owner','/conversations');
  const action=(actor:string,name:string,args:any={},extra={})=>raw(actor,'/agent-native/actions/'+name,{args},extra);
  const rpc=async(actor:string,method:string,params:unknown)=>{
    const response=await api.fetch(new Request('http://127.0.0.1/api/v1/projects/builder-demo/agent-native/mcp',{method:'POST',
      headers:{authorization:'Bearer fixture-'+actor,'content-type':'application/json',accept:'application/json, text/event-stream'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}));
    const text=await response.text();
    const payload=JSON.parse(text.startsWith('event:')||text.startsWith('data:')?text.split('\n').find(x=>x.startsWith('data:'))!.slice(5):text);
    return {status:response.status,body:payload,text};
  };
  const mcp=async(actor:string,name:string,args:any={})=>{
    const r=await rpc(actor,'tools/call',{name,arguments:args});
    let content=r.body.result?.structuredContent;
    if(!content){const value=r.body.result?.content?.[0]?.text;try{content=value?JSON.parse(value):r.body;}catch{content={errorText:value};}}
    return {...r,content};
  };
  const create=async()=>{const r=await action('owner','create_task',{operationId:'create',goal:'Implement summarizeChecks without dropping unknowns',acceptanceCriteria:['All rows counted','No input mutation']});assert.equal(r.status,200,JSON.stringify(r.body));return r.body.result.task;};
  const claim=async(task:any)=>{const r=await action('a','claim_task',{operationId:'claim',taskId:task.id,expectedRevision:task.revision});assert.equal(r.status,200,JSON.stringify(r.body));return r.body.result;};
  return{dir,repo,get api(){return api},get store(){return api.storeFor('builder-demo')!},raw,action,rpc,mcp,create,claim,
    restart:()=>{api.close();api=boot()},setTime:(s:string)=>{time=s},close:()=>{api.close();rmSync(dir,{recursive:true,force:true});}};
}
test('same actual Agent-Native registry powers UI and official MCP; bounded reads preserve unopened messages',async()=>{
 const f=await fixture();try{
  const t=await f.create();
  const list=await f.rpc('a','tools/list',{});assert.equal(list.status,200,list.text);
  assert.deepEqual(list.body.result.tools.map((x:any)=>x.name).sort(),[...ACTION_NAMES].sort());
  const p=await f.action('owner','post_message',{operationId:'msg',body:'Please preserve pending as unknown'});assert.equal(p.status,200,JSON.stringify(p));
  const c=await f.mcp('a','read_context',{taskId:t.id});assert.equal(c.body.result?.isError,undefined,c.text);
  assert.equal(c.content.result.task.id,t.id,c.text);assert.equal(c.content.result.messages[0].body,'Please preserve pending as unknown');
  assert.equal(c.content.result.messageConsumption,'not-acknowledged');
  const page=await f.raw('a','/conversations/team?after=0');assert.equal(page.body.cursor.opened,0);
  const replay=await f.action('owner','create_task',{operationId:'create',goal:t.goal,acceptanceCriteria:t.acceptanceCriteria});
  assert.equal(replay.body.result.task.id,t.id);assert.equal(Object.keys((await f.store.read()).tasks).length,1);
 }finally{f.close()}
});
test('human interjection denies stale MCP write without a file effect, reread permits it, duplicate is exact',async()=>{
 const f=await fixture();try{
  const t=await f.create(),claimed=await f.claim(t),a=claimed.assignment;
  const old=await f.action('a','read_context',{taskId:t.id});const rev=old.body.result.task.revision;
  const guard={taskId:t.id,taskRevision:rev,assignmentId:a.id,assignmentEpoch:a.epoch};
  const original=readFileSync(join(f.repo,'summary.mjs'),'utf8');
  const changed=await f.action('owner','update_task',{operationId:'interject',taskId:t.id,expectedRevision:rev,goal:'Keep every unknown row, including null'});
  assert.equal(changed.status,200,JSON.stringify(changed));
  const stale=await f.mcp('a','write_workspace',{...guard,operationId:'write1',file:'summary.mjs',content:solution});
  assert.equal(stale.body.result.isError,true,stale.text);assert.match(stale.text,/reread|requirements changed/i);
  assert.equal(readFileSync(join(f.repo,'summary.mjs'),'utf8'),original);
  const noRead=await f.action('a','write_workspace',{...guard,taskRevision:changed.body.result.task.revision,operationId:'write1',file:'summary.mjs',content:solution});
  assert.equal(noRead.body.error.code,'context_read_required');
  const fresh=await f.mcp('a','read_context',{taskId:t.id});const args={...guard,taskRevision:fresh.content.result.task.revision,operationId:'write1',file:'summary.mjs',content:solution};
  const write=await f.mcp('a','write_workspace',args);assert.equal(write.content.result.sha256,hash(solution),write.text);
  const duplicate=await f.action('a','write_workspace',args);assert.equal(duplicate.body.result.sha256,hash(solution));
  const mismatch=await f.action('a','write_workspace',{...args,content:solution+'// changed'});assert.equal(mismatch.body.error.code,'conflicting_operation');
  assert.equal(readFileSync(join(f.repo,'summary.mjs'),'utf8'),solution);
 }finally{f.close()}
});
test('scope, membership, current claim, strict schema, CSRF and file allowlist deny effects',async()=>{
 const f=await fixture();try{
  const t=await f.create(),{assignment:a}=await f.claim(t);const read=await f.action('a','read_context',{taskId:t.id});
  const args={operationId:'w',taskId:t.id,taskRevision:read.body.result.task.revision,assignmentId:a.id,assignmentEpoch:a.epoch,file:'summary.mjs',content:solution};
  const initial=readFileSync(join(f.repo,'summary.mjs'),'utf8');
  assert.equal((await f.action('a','write_workspace',{...args,file:'../outside'})).status,422);
  assert.equal((await f.action('a','write_workspace',{...args,actor:'owner'})).status,422);
  assert.equal((await f.action('a','write_workspace',args,{origin:'https://hostile.invalid'})).status,403);
  await f.action('b','read_context',{taskId:t.id});assert.equal((await f.action('b','write_workspace',args)).body.error.code,'assignment_not_current');
  await f.store.transact(s=>{s.credentials.ac.scopes=['read','conversation:read']});assert.equal((await f.action('a','write_workspace',args)).status,403);
  await f.store.transact(s=>{s.credentials.ac.scopes=[...scopes];s.assignments[a.id].leaseExpiresAt=new Date(Date.now()-1000).toISOString()});
  assert.equal((await f.action('a','write_workspace',args)).body.error.code,'assignment_not_current');
  await f.store.transact(s=>{s.credentials.ac.status='revoked'});assert.equal((await f.action('a','read_context',{})).status,401);
  assert.equal(readFileSync(join(f.repo,'summary.mjs'),'utf8'),initial);
 }finally{f.close()}
});
test('real candidate and fixed check preserve exact SHA/output, partial effects and check/review distinction',async()=>{
 const f=await fixture();try{
  const t=await f.create(),{assignment:a}=await f.claim(t);const r=await f.action('a','read_context',{taskId:t.id});
  const guard={taskId:t.id,taskRevision:r.body.result.task.revision,assignmentId:a.id,assignmentEpoch:a.epoch};
  assert.equal((await f.action('a','write_workspace',{...guard,operationId:'w',file:'summary.mjs',content:solution})).status,200);
  const verify=await f.action('a','verify_change',{...guard,operationId:'verify',summary:'Count every record and preserve unknowns'});
  assert.equal(verify.status,200,JSON.stringify(verify));
  let result:any;for(let n=0;n<80;n++){result=await f.action('owner','read_result',{verificationId:verify.body.result.verificationId});
    if(result.body.result.receipt)break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(result.body.result.status,'passed',JSON.stringify(result));assert.equal(result.body.result.receipt.outcome,'pass');
  assert.equal(result.body.result.outputSha256,hash(result.body.result.output));assert.match(result.body.result.diff,/summarizeChecks/);
  assert.equal(git(f.repo,'rev-parse','main'),git(f.repo,'rev-list','--max-parents=0','HEAD'));
  assert.equal(Object.keys((await f.store.read()).reviews).length,0);assert.ok(!JSON.stringify(result).includes('collectorTokenHash'));
  const duplicate=await f.action('a','verify_change',{...guard,operationId:'verify',summary:'Count every record and preserve unknowns'});
  assert.equal(duplicate.body.result.verificationId,verify.body.result.verificationId);assert.equal(Object.keys((await f.store.read()).jobs).length,1);
  const progress=await f.raw('a',`/tasks/${t.id}/progress`,{operationId:'status-only',expectedRevision:guard.taskRevision,
    assignmentId:a.id,assignmentEpoch:a.epoch,summary:'Check completed; independent review remains',nextAction:'Review evidence'});
  assert.equal(progress.status,200,JSON.stringify(progress));
  const statusOnly=await f.action('owner','read_result',{verificationId:verify.body.result.verificationId});
  assert.notEqual(statusOnly.body.result.currentTaskRevision,guard.taskRevision);assert.equal(statusOnly.body.result.matchesCurrentRequirements,true);
  await f.action('owner','update_task',{operationId:'later',taskId:t.id,expectedRevision:statusOnly.body.result.currentTaskRevision,goal:'A newer requirement'});
  const old=await f.action('owner','read_result',{verificationId:verify.body.result.verificationId});assert.equal(old.body.result.matchesCurrentRequirements,false);
 }finally{f.close()}
});

test('restart preserves task, agent identity, browser cookie, exact file effects and idempotent result',async()=>{
 const f=await fixture();try{
  const session=await f.api.fetch(new Request('http://127.0.0.1/api/v1/session',{method:'POST',headers:{authorization:'Bearer fixture-owner'}}));
  const cookie=session.headers.get('set-cookie')!.split(';')[0];
  const t=await f.create(),{assignment:a}=await f.claim(t);const c=await f.action('a','read_context',{taskId:t.id});
  const args={operationId:'persisted-write',taskId:t.id,taskRevision:c.body.result.task.revision,assignmentId:a.id,assignmentEpoch:a.epoch,file:'summary.mjs',content:solution};
  assert.equal((await f.action('a','write_workspace',args)).status,200);
  f.restart();
  const after=await f.action('a','read_context',{taskId:t.id});assert.equal(after.body.result.identity.id,'a');
  assert.equal(after.body.result.identity.sessionId,'as');assert.equal(after.body.result.assignment.id,a.id);
  assert.equal((await f.action('a','write_workspace',args)).body.result.sha256,hash(solution));
  const human=await f.api.fetch(new Request('http://127.0.0.1/api/v1/projects/builder-demo/agent-native/actions/read_context',
    {method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({args:{taskId:t.id}})}));
  assert.equal(human.status,200);assert.equal((await human.json()).result.task.id,t.id);
  assert.equal(readFileSync(join(f.repo,'summary.mjs'),'utf8'),solution);
 }finally{f.close()}
});

test('failed check dispatch preserves candidate and operation across restart without pretending no effect',async()=>{
 const f=await fixture();try{
  const t=await f.create(),{assignment:a}=await f.claim(t);const c=await f.action('a','read_context',{taskId:t.id});
  const guard={taskId:t.id,taskRevision:c.body.result.task.revision,assignmentId:a.id,assignmentEpoch:a.epoch};
  await f.action('a','write_workspace',{...guard,operationId:'w',file:'summary.mjs',content:solution});
  await f.store.transact(s=>{s.project.resourceLimits.maxActiveChecks=0});
  const args={...guard,operationId:'limited-verify',summary:'Preserve stages when a check cannot start'};
  const failed=await f.action('a','verify_change',args);assert.equal(failed.status,429,JSON.stringify(failed));
  const id=failed.body.error.verificationId;assert.ok(id);
  const result=await f.action('a','read_result',{verificationId:id});assert.equal(result.body.result.status,'error');
  assert.ok(result.body.result.candidate);assert.equal(result.body.result.job,null);assert.equal(result.body.result.receipt,null);
  const count=Object.keys((await f.store.read()).candidates).length;
  f.restart();const retry=await f.action('a','verify_change',args);assert.equal(retry.body.error.code,'operation_uncertain');
  assert.equal(Object.keys((await f.store.read()).candidates).length,count);
  assert.equal((await f.action('a','read_result',{verificationId:id})).body.result.candidate.id,result.body.result.candidate.id);
 }finally{f.close()}
});

test('legacy human edit and action file write share the serialized effect boundary',async()=>{
 const f=await fixture();try{
  const t=await f.create(),{assignment:a}=await f.claim(t);const c=await f.action('a','read_context',{taskId:t.id});
  const revision=c.body.result.task.revision,initial=readFileSync(join(f.repo,'summary.mjs'),'utf8');
  const edit=f.raw('owner','/tasks/'+t.id+'/update',{operationId:'raw-update',expectedRevision:revision,goal:'New requirement from advanced UI'});
  const write=f.action('a','write_workspace',{operationId:'overlap',taskId:t.id,taskRevision:revision,assignmentId:a.id,assignmentEpoch:a.epoch,file:'summary.mjs',content:solution});
  const [e,w]=await Promise.all([edit,write]);assert.equal(e.status,200);assert.equal(w.body.error.code,'stale_task');
  assert.equal(readFileSync(join(f.repo,'summary.mjs'),'utf8'),initial);
 }finally{f.close()}
});

test('a caller captured before scope reduction cannot write with its old scopes',async()=>{
 const f=await fixture();try{
  const t=await f.create(),{assignment:a}=await f.claim(t);const c=await f.action('a','read_context',{taskId:t.id});
  const args={operationId:'old-scope',taskId:t.id,taskRevision:c.body.result.task.revision,assignmentId:a.id,assignmentEpoch:a.epoch,file:'summary.mjs',content:solution};
  const request=new Request('http://127.0.0.1/api/v1/projects/builder-demo/agent-native/actions/write_workspace',{
    method:'POST',headers:{authorization:'Bearer fixture-a','content-type':'application/json'},body:JSON.stringify({args})});
  const binding={request,projectId:'builder-demo',principal:{id:'a',sessionId:'as',kind:'agent' as const,ownerId:'owner',scopes:[...scopes],projectIds:['builder-demo']},
    store:f.store,dispatch:(r:Request)=>f.api.fetch(r),now:()=>new Date().toISOString()};
  const service=new BuilderActions({projectId:'builder-demo',repo:f.repo,stateDir:join(f.dir,'isolated-queued-binding'),checkStateDir:join(f.dir,'results')});
  await f.store.transact(s=>{s.credentials.ac.scopes=['read','conversation:read']});
  const response=await service.fetch(request,binding);assert.equal(response.status,403);
  assert.equal((await response.json()).error.code,'scope_denied');
  assert.match(readFileSync(join(f.repo,'summary.mjs'),'utf8'),/Not implemented yet/);
 }finally{f.close()}
});

test('two installations on one hostname keep independent HttpOnly sessions across ports and restart',async()=>{
 const a=await fixture(),b=await fixture();try{
  const login=(f:any)=>f.api.fetch(new Request('http://127.0.0.1/api/v1/session',{method:'POST',headers:{authorization:'Bearer fixture-owner'}}));
  const x=await login(a),y=await login(b),cx=x.headers.get('set-cookie')!,cy=y.headers.get('set-cookie')!;
  assert.match(cx,/HttpOnly; SameSite=Strict; Path=\/api/);assert.match(cy,/HttpOnly; SameSite=Strict; Path=\/api/);
  assert.notEqual(cx.split('=')[0],cy.split('=')[0]);
  const cookies=cx.split(';')[0]+'; '+cy.split(';')[0];
  const ta=await a.create(),tb=await b.create();
  const context=(f:any)=>f.api.fetch(new Request('http://127.0.0.1/api/v1/projects/builder-demo/agent-native/actions/read_context',
    {method:'POST',headers:{cookie:cookies},body:JSON.stringify({args:{}})}));
  assert.equal((await (await context(a)).json()).result.task.id,ta.id);
  assert.equal((await (await context(b)).json()).result.task.id,tb.id);
  a.restart();assert.equal((await (await context(a)).json()).result.task.id,ta.id);
  const logout=await a.api.fetch(new Request('http://127.0.0.1/api/v1/session',{method:'DELETE',headers:{cookie:cookies}}));
  assert.ok(logout.headers.get('set-cookie')!.startsWith(cx.split('=')[0]+'='));
  assert.equal((await context(a)).status,401);assert.equal((await context(b)).status,200);
 }finally{a.close();b.close()}
});
