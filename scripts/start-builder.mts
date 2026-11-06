import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {startDemo,parseOptions,plannedRealPath} from './start-local.mts';
import {BuilderActions} from '../agent-native/server.ts';

export function builderOptions(args:string[],env:NodeJS.ProcessEnv=process.env){
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22||(major===22&&minor<22))throw Error('Agent-Native entry requires Node >=22.22');
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const opts=parseOptions(args,{...env,TOGETHER_STATE_DIR:env.TOGETHER_STATE_DIR??resolve(root,'../private/builder-state')});
  const actual=plannedRealPath(opts.stateDir),actualRoot=plannedRealPath(root);
  if(actual===actualRoot||actual.startsWith(actualRoot+sep))throw Error('Builder private state must be outside the served source tree');
  return opts;
}
export const startBuilder=(options:ReturnType<typeof builderOptions>)=>startDemo(options,{
  projectId:'builder-demo',goal:'Build a small change together',destination:'/builder?project=builder-demo',
  actions:({repo,stateDir,checkStateDir})=>new BuilderActions({projectId:'builder-demo',repo,
    stateDir:resolve(stateDir,'builder-actions'),checkStateDir}),
});
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{
    const app=await startBuilder(builderOptions(process.argv.slice(2)));
    console.log(`Together Builder workroom: ${app.origin}/local-login`);
    console.log(`Private state: ${app.stateDir}`);
    console.log('Connect a scoped external agent with npm run builder:agent:setup. No agent or provider runs automatically.');
    let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await app.close();};
    process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
  }catch(error){console.error(error instanceof Error?error.message:'Builder startup failed');process.exitCode=1;}
}
