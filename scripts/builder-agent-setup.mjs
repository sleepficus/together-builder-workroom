// Project-scoped HTTP MCP setup. Credentials stay in private local files;
// registration, provider calls and global client configuration stay untouched.
import {readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setupAgent,setupFailure,BUILDER_SCOPES} from './agent-setup.mjs';

export async function setupBuilderAgent(options={}){
 const stateDir=options.stateDir??process.env.TOGETHER_STATE_DIR;
 if(typeof stateDir!=='string'||!stateDir.trim())throw Error('Builder setup needs --state-dir or TOGETHER_STATE_DIR from start:builder');
 // setupAgent validates the private state and builder-demo binding before
 // enrollment; a same-name work/chat connection has a different cache key.
 const connection=await setupAgent({...options,stateDir,profile:'builder'});
 const saved=JSON.parse(readFileSync(connection.configPath,'utf8'));
 const endpoint=saved.baseUrl+'/api/v1/projects/builder-demo/agent-native/mcp';
 const configPath=connection.configPath.replace(/\.json$/,'.http-mcp.json');
 try{
  const stat=lstatSync(configPath);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o600||(process.getuid&&stat.uid!==process.getuid()))throw Error('Builder MCP config must be an owned private regular file');
 }catch(error){if(error?.code!=='ENOENT')throw error;}
 const config={transport:'http',url:endpoint,credentialFile:saved.credentialFile,
  projectId:'builder-demo',profile:'builder',scopes:[...BUILDER_SCOPES],
  identityId:connection.identityId,sessionId:connection.sessionId,
  expiresAt:connection.expiresAt,expiryStatus:connection.expiryStatus};
 writeFileSync(configPath,JSON.stringify(config,null,2)+'\n',{mode:0o600});
 return {reused:connection.reused,projectId:'builder-demo',profile:'builder',
  identityId:connection.identityId,sessionId:connection.sessionId,
  mcpEndpoint:endpoint,configPath,credentialFile:saved.credentialFile,
  expiresAt:connection.expiresAt,expiryStatus:connection.expiryStatus,expiryNote:connection.expiryNote,
  scopes:[...BUILDER_SCOPES],registration:'not registered; private HTTP configuration only'};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const argv=process.argv.slice(2),options={};
  if(argv.includes('--help'))console.log('node --import tsx scripts/builder-agent-setup.mjs --name "Your agent" [--host codex|claude|other] [--days 30] --state-dir PATH');
  else{
   for(let i=0;i<argv.length;i++){
    const key={'--name':'name','--host':'host','--days':'days','--state-dir':'stateDir'}[argv[i]];
    if(!key||!argv[i+1])throw Error('Use --help for setup options');
    options[key]=key==='days'?Number(argv[++i]):argv[++i];
   }
   console.log(JSON.stringify(await setupBuilderAgent(options),null,2));
  }
 }catch(error){console.error(JSON.stringify(setupFailure(error)));process.exitCode=1;}
}
