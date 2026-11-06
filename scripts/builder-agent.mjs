// A deliberate, single-call HTTP MCP client. No enrollment, provider calls,
// global registration, automatic retries or saved-credential changes.
import {constants,openSync,fstatSync,readFileSync,closeSync,lstatSync} from 'node:fs';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {cliFailure,displayResult} from './crew-mcp.mjs';

const usage="node scripts/builder-agent.mjs [--pretty|--raw] CONFIG list | TOOL 'JSON'";
const failure=(code,message)=>({error:{code,message,automaticRetry:false}});
const localError=code=>Object.assign(new Error(code),{localCode:code});

function privateRead(path,maxBytes){
 let fd;
 try{
  // O_NOFOLLOW closes the leaf-symlink race between validation and reading.
  const before=lstatSync(path);
  if(before.isSymbolicLink())throw localError('private_file_required');
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const stat=fstatSync(fd);
  if(!stat.isFile()||(stat.mode&0o7777)!==0o600||
    (process.getuid&&stat.uid!==process.getuid())||stat.size>maxBytes||
    stat.dev!==before.dev||stat.ino!==before.ino)throw localError('private_file_required');
  const bytes=readFileSync(fd);
  if(bytes.length>maxBytes)throw localError('private_file_required');
  return bytes.toString('utf8');
 }catch{throw localError('private_file_required');}
 finally{if(fd!==undefined)closeSync(fd);}
}

export function loopbackEndpoint(value){
 let url;try{url=new URL(value);}catch{throw localError('loopback_endpoint_required');}
 // Literal addresses avoid a DNS lookup changing where the bearer is sent.
 if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.hash||url.search)throw localError('loopback_endpoint_required');
 return url;
}

export function readBuilderConnection(configPath){
 const path=resolve(configPath);let config;
 try{config=JSON.parse(privateRead(path,64*1024));}catch(error){if(error.localCode)throw error;throw localError('invalid_config');}
 if(!config||config.transport!=='http'||typeof config.url!=='string'||typeof config.credentialFile!=='string'||!config.credentialFile.trim())throw localError('invalid_config');
 const url=loopbackEndpoint(config.url);
 const credentialPath=isAbsolute(config.credentialFile)?config.credentialFile:resolve(dirname(path),config.credentialFile);
 const token=privateRead(credentialPath,16*1024).trim();
 if(!token||!/^[A-Za-z0-9._~+/-]+=*$/.test(token))throw localError('invalid_credential');
 return {url,token};
}

const localMessages={
 private_file_required:'Config and credential files must be owned regular files with mode 0600, without symlinks, and within the size limit.',
 invalid_config:'Use the private HTTP MCP config produced by builder-agent-setup.',
 invalid_credential:'The private credential file does not contain a valid bearer credential.',
 loopback_endpoint_required:'The MCP endpoint must use HTTP or HTTPS on literal 127.0.0.1 or ::1, without URL credentials, query or fragment.',
 request_timeout:'The bounded MCP request timed out. Its outcome may be unknown; inspect current project state before a deliberate retry.',
 redirect_refused:'The MCP endpoint attempted a redirect. No redirected request was sent.',
};

export async function runBuilderAgentCLI(argv,options={}){
 const out=options.out??(value=>console.log(value)),err=options.err??(value=>console.error(value));
 const args=[...argv];let pretty=false;
 if(args[0]==='--pretty'||args[0]==='--raw')pretty=args.shift()==='--pretty';
 if(args.length===1&&args[0]==='--help'){out(usage);return 0;}
 const [configPath,tool,...rest]=args;
 if(!configPath||!tool||(tool==='list'?rest.length!==0:rest.length!==1)){
  err(JSON.stringify(failure('cli_usage','Use: '+usage)));return 1;
 }
 let input={};
 if(rest.length){
  try{input=JSON.parse(rest[0]);}catch{err(JSON.stringify(failure('invalid_json_arguments','Tool arguments must be one quoted JSON object.')));return 1;}
  if(!input||typeof input!=='object'||Array.isArray(input)){err(JSON.stringify(failure('invalid_tool_arguments','Tool arguments must be a JSON object.')));return 1;}
 }
 let client,token='',phase='connect',code=0,timer;
 const controller=new AbortController();
 const timeoutMs=Number.isInteger(options.timeoutMs)&&options.timeoutMs>0&&options.timeoutMs<=15000?options.timeoutMs:15000;
 // Scrub even a malicious server that echoes the bearer in a result/error.
 const scrub=value=>token?value.split(token).join('[REDACTED]'):value;
 try{
  const connection=readBuilderConnection(configPath);token=connection.token;
  const endpoint=connection.url;
  const guardedFetch=async(input,init={})=>{
   const target=loopbackEndpoint(input instanceof Request?input.url:String(input));
   if(target.href!==endpoint.href)throw localError('loopback_endpoint_required');
   const signal=init.signal?AbortSignal.any([controller.signal,init.signal]):controller.signal;
   const response=await fetch(input,{...init,redirect:'manual',signal});
   if(response.status>=300&&response.status<400){await response.body?.cancel();throw localError('redirect_refused');}
   return response;
  };
  const transport=new StreamableHTTPClientTransport(endpoint,{
   fetch:guardedFetch,requestInit:{headers:{authorization:'Bearer '+token},redirect:'manual'},
   reconnectionOptions:{maxRetries:0,initialReconnectionDelay:1000,maxReconnectionDelay:1000,reconnectionDelayGrowFactor:1},
  });
  client=new Client({name:'together-builder-http-cli',version:'1.0.0'},{capabilities:{}});
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(localError('request_timeout'));},timeoutMs);});
  const operation=(async()=>{
   await client.connect(transport,{timeout:timeoutMs,signal:controller.signal});phase='call';
   const requestOptions={timeout:timeoutMs,signal:controller.signal};
   return tool==='list'?await client.listTools({},requestOptions):await client.callTool({name:tool,arguments:input},undefined,requestOptions);
  })();
  const result=await Promise.race([operation,deadline]);
  out(scrub(displayResult(result,pretty)));if(result.isError)code=1;
 }catch(error){
  const localCode=controller.signal.aborted?'request_timeout':error?.localCode;
  const result=Object.hasOwn(localMessages,localCode)?failure(localCode,localMessages[localCode]):cliFailure(error,phase);
  err(scrub(JSON.stringify(result)));code=1;
 }finally{
  clearTimeout(timer);controller.abort();
  try{await client?.close();}catch{err(JSON.stringify(failure('transport_close_failed','The MCP transport did not close cleanly. No call was repeated.')));code=1;}
 }
 return code;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await runBuilderAgentCLI(process.argv.slice(2));
