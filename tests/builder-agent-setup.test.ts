import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync,statSync,existsSync,mkdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {startLocalServer} from '../cloud/local-server.ts';
// @ts-ignore JavaScript local setup implementation.
import {setupAgent,BUILDER_SCOPES} from '../scripts/agent-setup.mjs';
// @ts-ignore JavaScript local setup implementation.
import {setupBuilderAgent} from '../scripts/builder-agent-setup.mjs';

const EXACT=['read','conversation:read','conversation:write','tasks:write','tasks:claim','tasks:progress','changes:write','checks:write'];
async function fixture(t:any,projectId='builder-demo'){
 const stateDir=mkdtempSync(join(tmpdir(),'builder-setup-fixture-')),owner='OFFLINE-OWNER-'+randomUUID();
 const start=()=>startLocalServer({port:0,stateDir,ownerTokens:[{ownerId:'fixture-owner',token:owner}],seedProjects:[{id:projectId,goal:'Synthetic setup test, no model called'}]});
 let server=start();
 const port=await server.listening;let origin='http://127.0.0.1:'+port;
 writeFileSync(join(stateDir,'app.lock'),JSON.stringify({apiOrigin:origin,projectId})+'\n',{mode:0o600});
 writeFileSync(join(stateDir,'owner-token'),owner+'\n',{mode:0o600});
 t.after(async()=>{server.server.closeAllConnections();await new Promise<void>((yes,no)=>server.server.close(error=>error?no(error):yes()));rmSync(stateDir,{recursive:true,force:true});});
 const request=async(path:string,token=owner,body?:any)=>fetch(origin+'/api/v1/projects/'+projectId+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const restart=async(editState?:(state:any)=>void)=>{server.server.closeAllConnections();await new Promise<void>((yes,no)=>server.server.close(error=>error?no(error):yes()));if(editState){const path=join(stateDir,projectId+'.json'),doc=JSON.parse(readFileSync(path,'utf8'));editState(doc.state);writeFileSync(path,JSON.stringify(doc)+'\n',{mode:0o600});}server=start();const port=await server.listening;origin='http://127.0.0.1:'+port;writeFileSync(join(stateDir,'app.lock'),JSON.stringify({apiOrigin:origin,projectId})+'\n',{mode:0o600});};
 return {stateDir,owner,get origin(){return origin;},request,restart};
}

test('builder setup issues exactly the bounded scopes and private HTTP config, without token output',async t=>{
 const f=await fixture(t),connection=await setupBuilderAgent({name:'Synthetic Codex fixture',host:'codex',stateDir:f.stateDir});
 assert.equal(connection.projectId,'builder-demo');assert.equal(connection.profile,'builder');assert.equal(connection.reused,false);
 assert.deepEqual(connection.scopes,EXACT);assert.deepEqual([...BUILDER_SCOPES],EXACT);
 assert.equal(connection.mcpEndpoint,f.origin+'/api/v1/projects/builder-demo/agent-native/mcp');
 assert.equal(statSync(connection.configPath).mode&0o777,0o600);assert.equal(statSync(connection.credentialFile).mode&0o777,0o600);
 assert.ok(!resolve(connection.configPath).startsWith(resolve('.')+'/'));
 const config=JSON.parse(readFileSync(connection.configPath,'utf8')),token=readFileSync(config.credentialFile,'utf8').trim();
 assert.equal(config.transport,'http');assert.equal(config.url,connection.mcpEndpoint);assert.equal(config.credentialFile,connection.credentialFile);
 assert.equal(config.identityId,connection.identityId);assert.equal(config.sessionId,connection.sessionId);
 assert.ok(!JSON.stringify(connection).includes(token));assert.ok(!JSON.stringify(config).includes(token));assert.ok(!JSON.stringify(connection).includes(f.owner));
 assert.equal(connection.expiryStatus,'enrollment-response');assert.ok(Date.parse(connection.expiresAt)>Date.now()+29*86400000);
 const context=await f.request('/work-context',token).then(r=>r.json());
 assert.deepEqual(context.capabilities.sort(),[...EXACT].sort());assert.equal(context.identity.id,connection.identityId);
 assert.equal((await f.request('/identities',token,{operationId:'forbidden-identity',displayName:'Must not exist'})).status,403);
 assert.equal((await f.request('/candidates/missing/reviews',token,{operationId:'forbidden-review'})).status,403);
});

test('reuse preserves identity/session/credential and original expiry without global registration',async t=>{
 const f=await fixture(t),options={name:'Stable Builder fixture',host:'codex',stateDir:f.stateDir};
 const first=await setupBuilderAgent({...options,days:1}),token=readFileSync(first.credentialFile,'utf8');
 await f.restart();
 const second=await setupBuilderAgent({...options,days:30});
 assert.equal(second.reused,true);assert.equal(second.identityId,first.identityId);assert.equal(second.sessionId,first.sessionId);assert.equal(second.configPath,first.configPath);
 assert.equal(second.expiresAt,first.expiresAt);assert.equal(second.expiryStatus,'cached-enrollment-value');assert.match(second.expiryNote,/does not renew/);
 assert.equal(readFileSync(second.credentialFile,'utf8'),token);assert.match(second.registration,/not registered/);
 assert.equal(second.mcpEndpoint,f.origin+'/api/v1/projects/builder-demo/agent-native/mcp');
 const ownerState=await f.request('').then(r=>r.json());assert.equal(Object.keys(ownerState.identities).length,2);
});

test('builder has a distinct cache from unchanged work/chat setup with the same name',async t=>{
 const f=await fixture(t),options={name:'Same name fixture',host:'other',stateDir:f.stateDir};
 const builder=await setupBuilderAgent(options),work=await setupAgent({...options,profile:'work'}),chat=await setupAgent({...options,profile:'chat'});
 assert.notEqual(builder.identityId,work.identityId);assert.notEqual(builder.identityId,chat.identityId);
 assert.notEqual(work.configPath,chat.configPath);assert.notEqual(builder.configPath,work.configPath);
 const workBytes=readFileSync(work.configPath,'utf8'),again=await setupAgent({...options,profile:'work'});
 assert.equal(again.reused,true);assert.equal(again.identityId,work.identityId);assert.equal(readFileSync(work.configPath,'utf8'),workBytes);
 const files=readdirSync(join(f.stateDir,'agents')).filter(x=>x.endsWith('.token'));assert.equal(files.length,3);
});

test('wrong project refuses before identity or private-agent metadata creation',async t=>{
 const f=await fixture(t,'local-demo');
 await assert.rejects(setupBuilderAgent({name:'Wrong project fixture',stateDir:f.stateDir}),/requires project builder-demo/);
 assert.equal(existsSync(join(f.stateDir,'agents')),false);
 const state=await f.request('').then(r=>r.json());assert.equal(Object.keys(state.identities).length,1);
});

test('private Builder state inside served source is refused before enrollment',async t=>{
 const stateDir=mkdtempSync(resolve('.builder-setup-refusal-'));
 t.after(()=>rmSync(stateDir,{recursive:true,force:true}));
 writeFileSync(join(stateDir,'app.lock'),JSON.stringify({apiOrigin:'http://127.0.0.1:1',projectId:'builder-demo'}),{mode:0o600});
 await assert.rejects(setupBuilderAgent({name:'Inside app fixture',stateDir}),/outside the application source/);
 assert.equal(existsSync(join(stateDir,'agents')),false);
});

test('an in-app symlink path cannot hide an externally stored private config',async t=>{
 const outside=mkdtempSync(join(tmpdir(),'builder-setup-outside-')),inside=mkdtempSync(resolve('.builder-setup-link-'));
 t.after(()=>{rmSync(inside,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});});
 const realState=join(outside,'state');mkdirSync(realState,{mode:0o700});
 writeFileSync(join(realState,'app.lock'),JSON.stringify({apiOrigin:'http://127.0.0.1:1',projectId:'builder-demo'}),{mode:0o600});
 symlinkSync(outside,join(inside,'linked'));
 await assert.rejects(setupBuilderAgent({name:'Linked fixture',stateDir:join(inside,'linked','state')}),/outside the application source/);
 assert.equal(existsSync(join(realState,'agents')),false);
});

test('denied existing Builder credential is not replaced or silently reenrolled',async t=>{
 const f=await fixture(t),options={name:'Denied Builder fixture',stateDir:f.stateDir};
 const connection=await setupBuilderAgent(options),before=readFileSync(connection.configPath,'utf8');
 writeFileSync(connection.credentialFile,'OFFLINE-INVALID-CREDENTIAL\n',{mode:0o600});
 await assert.rejects(setupBuilderAgent(options),/not replaced/);
 assert.equal(readFileSync(connection.configPath,'utf8'),before);
 assert.equal(readFileSync(connection.credentialFile,'utf8'),'OFFLINE-INVALID-CREDENTIAL\n');
 const state=await f.request('').then(r=>r.json());assert.equal(Object.keys(state.identities).length,2);
});

test('expired Builder connection is not revived or extended',async t=>{
 const f=await fixture(t),options={name:'Expired Builder fixture',stateDir:f.stateDir};
 const connection=await setupBuilderAgent({...options,days:1}),before=readFileSync(connection.configPath,'utf8'),token=readFileSync(connection.credentialFile,'utf8');
 // The local server's injectable handler clock does not control its outer
 // bearer authentication. Expire only our disposable persisted credential,
 // then reopen the server so this exercises the actual auth rejection.
 await f.restart(state=>{for(const credential of Object.values(state.credentials) as any[])if(credential.identityId===connection.identityId)credential.expiresAt='2000-01-01T00:00:00.000Z';});
 await assert.rejects(setupBuilderAgent({...options,days:30}),/not replaced/);
 assert.equal(readFileSync(connection.configPath,'utf8'),before);assert.equal(readFileSync(connection.credentialFile,'utf8'),token);
 const state=await f.request('').then(r=>r.json());assert.equal(Object.keys(state.identities).length,2);
});

test('revoked Builder identity remains revoked on setup reuse',async t=>{
 const f=await fixture(t),options={name:'Revoked Builder fixture',stateDir:f.stateDir};
 const connection=await setupBuilderAgent(options),before=readFileSync(connection.configPath,'utf8'),token=readFileSync(connection.credentialFile,'utf8');
 const state=await f.request('').then(r=>r.json());
 const revoked=await f.request('/identities/'+connection.identityId+'/revoke',f.owner,{operationId:'revoke-builder-fixture',expectedRevision:state.identities[connection.identityId].revision});
 assert.equal(revoked.status,200);
 await assert.rejects(setupBuilderAgent(options),/not replaced/);
 assert.equal(readFileSync(connection.configPath,'utf8'),before);assert.equal(readFileSync(connection.credentialFile,'utf8'),token);
 const after=await f.request('').then(r=>r.json());assert.equal(after.identities[connection.identityId].status,'revoked');assert.equal(Object.keys(after.identities).length,2);
});

test('preflight failure allows retry; uncertain identity retains marker and blocks duplicate',async t=>{
 const f=await fixture(t),realFetch=globalThis.fetch,options={name:'Preflight Builder fixture',stateDir:f.stateDir};
 try{
  globalThis.fetch=async(input,init)=>{if(String(input).endsWith('/conversations'))throw Error('Synthetic preflight offline');return realFetch(input,init);};
  await assert.rejects(setupBuilderAgent(options),/preflight offline/);
 }finally{globalThis.fetch=realFetch;}
 assert.equal(readdirSync(join(f.stateDir,'agents')).length,0);
 const retry=await setupBuilderAgent(options);assert.equal(retry.reused,false);
 const uncertain={name:'Uncertain Builder fixture',stateDir:f.stateDir};
 try{
  globalThis.fetch=async(input,init)=>{const response=await realFetch(input,init);if(String(input).endsWith('/identities')&&init?.method==='POST')throw Error('Synthetic committed response lost');return response;};
  await assert.rejects(setupBuilderAgent(uncertain),/committed response lost/);
 }finally{globalThis.fetch=realFetch;}
 const before=await f.request('').then(r=>r.json());
 await assert.rejects(setupBuilderAgent(uncertain),/interrupted/);
 const after=await f.request('').then(r=>r.json());assert.equal(Object.keys(after.identities).length,Object.keys(before.identities).length);
});
