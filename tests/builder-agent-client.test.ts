import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,writeFileSync,rmSync,chmodSync,symlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-ignore Deliberate JavaScript CLI surface.
import {runBuilderAgentCLI,loopbackEndpoint,readBuilderConnection} from '../scripts/builder-agent.mjs';

const TOKEN='OFFLINE-BUILDER-SECRET-do-not-print';
async function fixture(t:any,respond?:(req:any,res:any,body:any)=>boolean){
 const dir=mkdtempSync(join(tmpdir(),'builder-http-client-'));
 const requests:any[]=[];
 const server=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
  requests.push({method:req.method,path:req.url,auth:req.headers.authorization,body});
  if(respond?.(req,res,body))return;
  if(req.method==='GET'){res.writeHead(405);res.end();return;}
  if(!body?.id&&body?.id!==0){res.writeHead(202);res.end();return;}
  const result=body.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'offline-fixture',version:'1'}}:
   body.method==='tools/list'?{tools:[{name:'read_context',inputSchema:{type:'object'}}]}:
   {content:[{type:'text',text:JSON.stringify({ok:true,args:body.params.arguments})}]};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const url='http://127.0.0.1:'+(server.address() as any).port+'/mcp';
 const credentialFile=join(dir,'agent.token'),config=join(dir,'agent.http-mcp.json');
 writeFileSync(credentialFile,TOKEN+'\n',{mode:0o600});
 const save=(patch:any={})=>writeFileSync(config,JSON.stringify({transport:'http',url,credentialFile,...patch}),{mode:0o600});save();
 t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(dir,{recursive:true,force:true});});
 return {dir,config,credentialFile,requests,url,save};
}
async function invoke(args:string[],timeoutMs=2000){
 const stdout:string[]=[],stderr:string[]=[];
 const code=await runBuilderAgentCLI(args,{timeoutMs,out:(s:string)=>stdout.push(s),err:(s:string)=>stderr.push(s)});
 assert.ok(!stdout.join('').includes(TOKEN));assert.ok(!stderr.join('').includes(TOKEN));
 return {code,stdout,stderr,error:stderr.length?JSON.parse(stderr[0]).error:undefined};
}

test('official SDK initializes, lists and deliberately calls once with private bearer; config stays unchanged',async t=>{
 const f=await fixture(t),before=readFileSync(f.config,'utf8'),token=readFileSync(f.credentialFile,'utf8');
 const listed=await invoke([f.config,'list']);assert.equal(listed.code,0);assert.equal(JSON.parse(listed.stdout[0]).tools[0].name,'read_context');
 assert.deepEqual(f.requests.filter(r=>r.body?.id!==undefined).map(r=>r.body.method),['initialize','tools/list']);
 assert.ok(f.requests.every(r=>r.auth==='Bearer '+TOKEN));
 f.requests.length=0;
 const called=await invoke(['--pretty',f.config,'read_context','{"taskId":"task-1"}']);
 assert.equal(called.code,0);assert.deepEqual(JSON.parse(called.stdout[0]),{ok:true,args:{taskId:'task-1'}});
 assert.equal(f.requests.filter(r=>r.body?.method==='tools/call').length,1);
 assert.equal(f.requests.some(r=>r.method==='DELETE'),false);
 assert.equal(readFileSync(f.config,'utf8'),before);assert.equal(readFileSync(f.credentialFile,'utf8'),token);
});

test('malformed input and extra args are refused before any connection or default write',async t=>{
 const f=await fixture(t);
 for(const args of [[f.config],[f.config,'create_task'],[f.config,'list','{}'],[f.config,'create_task','{"secret":"'+TOKEN],[f.config,'create_task','[]'],[f.config,'read_context','{}','{}']]){
  const result=await invoke(args);assert.equal(result.code,1);assert.equal(result.error.automaticRetry,false);
 }
 assert.equal(f.requests.length,0);
});

test('nonloopback, URL credentials, query, fragments and hostname targets are refused before credential transmission',async t=>{
 const f=await fixture(t);
 for(const url of ['https://example.com/mcp','http://localhost:1234/mcp','http://127.0.0.2/mcp','file:///tmp/a','http://u:p@127.0.0.1/mcp','http://127.0.0.1/mcp?token=x','http://127.0.0.1/mcp#x']){
  f.save({url});const result=await invoke([f.config,'list']);assert.equal(result.error.code,'loopback_endpoint_required');
 }
 assert.equal(loopbackEndpoint('http://[::1]:1234/mcp').hostname,'[::1]');assert.equal(f.requests.length,0);
});

test('mode and symlink protection applies to config and credential files before connecting',async t=>{
 const f=await fixture(t);
 for(const file of [f.config,f.credentialFile]){
  chmodSync(file,0o644);assert.equal((await invoke([f.config,'list'])).error.code,'private_file_required');chmodSync(file,0o600);
 }
 const configLink=join(f.dir,'config-link'),tokenLink=join(f.dir,'token-link');
 symlinkSync(f.config,configLink);assert.equal((await invoke([configLink,'list'])).error.code,'private_file_required');
 symlinkSync(f.credentialFile,tokenLink);f.save({credentialFile:tokenLink});assert.equal((await invoke([f.config,'list'])).error.code,'private_file_required');
 f.save({credentialFile:f.dir});assert.equal((await invoke([f.config,'list'])).error.code,'private_file_required');
 assert.equal(f.requests.length,0);
});

test('ownership comparison refuses a different uid before connecting',async t=>{
 const f=await fixture(t),uid=process.getuid!();
 const ownership=t.mock.method(process,'getuid',()=>uid+1);
 try{assert.throws(()=>readBuilderConnection(f.config),error=>(error as any).localCode==='private_file_required');}
 finally{ownership.mock.restore();}
 assert.equal(f.requests.length,0);
});

test('redirect response is never followed, including a same-origin target',async t=>{
 const f=await fixture(t,(req,res)=>{res.writeHead(307,{location:'/stolen'});res.end();return true;});
 const result=await invoke([f.config,'list']);assert.equal(result.code,1);assert.equal(f.requests.length,1);assert.equal(f.requests[0].path,'/mcp');
 assert.equal(result.error.code,'redirect_refused');
});

test('server failures and secret echoes never print credentials or repeat a tool call',async t=>{
 const f=await fixture(t,(req,res,body)=>{
  if(body?.method!=='tools/call')return false;
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:{isError:true,content:[{type:'text',text:TOKEN}]}}));return true;
 });
 const result=await invoke([f.config,'write_workspace','{}']);assert.equal(result.code,1);assert.match(result.stdout[0],/REDACTED/);
 assert.equal(f.requests.filter(r=>r.body?.method==='tools/call').length,1);
});

test('HTTP failure body containing a credential is suppressed without retries',async t=>{
 const f=await fixture(t,(req,res)=>{res.writeHead(500,{'content-type':'text/plain'});res.end(TOKEN);return true;});
 const result=await invoke([f.config,'list']);assert.equal(result.code,1);assert.equal(result.error.automaticRetry,false);assert.equal(f.requests.length,1);
});

test('one overall deadline aborts a hanging request without retry or later write',async t=>{
 const f=await fixture(t,()=>true),start=Date.now();
 const result=await invoke([f.config,'write_workspace','{}'],100);
 assert.equal(result.code,1);assert.equal(result.error.code,'request_timeout');assert.ok(Date.now()-start<1500);
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].body.method,'initialize');
});
