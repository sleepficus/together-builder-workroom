import {defineAction} from '@agent-native/core/action';
import {createMCPServerForRequest} from '@agent-native/core/mcp';
import {handleMcpFetchRequest} from '@agent-native/core/mcp/fetch';
import {z} from 'zod';

const id=z.string().regex(/^[a-zA-Z0-9_.:-]{1,120}$/);
const rev=z.number().int().positive();
const prose=z.string().trim().min(1).max(12000);
const guard={operationId:id,taskId:id,taskRevision:rev,assignmentId:id,assignmentEpoch:rev};
const schemas={
  read_context:z.object({taskId:id.optional(),after:z.number().int().nonnegative().optional(),limit:z.number().int().min(1).max(10).optional()}).strict(),
  create_task:z.object({operationId:id,goal:prose,acceptanceCriteria:z.array(prose).min(1).max(12),nextAction:prose.optional()}).strict(),
  claim_task:z.object({operationId:id,taskId:id,expectedRevision:rev}).strict(),
  post_message:z.object({operationId:id,body:z.string().min(1).max(2000),replyToId:id.optional()}).strict(),
  update_task:z.object({operationId:id,taskId:id,expectedRevision:rev,goal:prose.optional(),acceptanceCriteria:z.array(prose).min(1).max(12).optional(),nextAction:prose.optional()}).strict(),
  read_workspace:z.object({taskId:id,file:z.enum(['README.md','summary.mjs','summary.test.mjs'])}).strict(),
  write_workspace:z.object({...guard,file:z.literal('summary.mjs'),content:z.string().max(12000)}).strict(),
  verify_change:z.object({...guard,summary:prose}).strict(),
  read_result:z.object({verificationId:id}).strict(),
};
const descriptions={
  read_context:'Read current task revision, caller claim and bounded shared messages; required before writing. Does not acknowledge messages as opened.',
  create_task:'Create a task with the exact human request and explicit acceptance criteria.',
  claim_task:'Claim the current task revision as the authenticated caller, with a bounded lease.',
  post_message:'Post a shared message attributed to the authenticated caller.',
  update_task:'Human changes task requirements at an expected revision; existing agent must reread.',
  read_workspace:'Read one allowlisted file in the bounded check-summary exercise.',
  write_workspace:'Write summary.mjs only after reading current requirements, with active caller-bound claim and operation ID.',
  verify_change:'Preserve a real Git candidate and start the fixed check; poll read_result. A passing check is not independent review or integration.',
  read_result:'Read actual candidate diff and authenticated collector evidence, including partial or failed verification steps.',
};
export function makeActions(service,binding){
  return Object.fromEntries(Object.entries(schemas).map(([name,schema])=>[name,defineAction({
    description:descriptions[name],schema,outputSchema:z.object({ok:z.literal(true),result:z.unknown()}),
    http:{method:'POST'},readOnly:['read_context','read_workspace','read_result'].includes(name),
    audit:{enabled:false},changeEvents:false,
    authorize:async()=>{await service.authorize(binding,name);return true;},
    run:async args=>({ok:true,result:await service.execute(binding,name,args)}),
  })]));
}
export function serveMcp(request,actions){
  const config={name:'Together Builder',description:'Shared bounded coding workspace',version:'1.0.0',
    catalogMode:'app',actions,builtinCrossAppTools:false};
  // Explicitly no fabricated verified user or fallback framework-owner identity.
  const identity={userEmail:undefined,orgDomain:undefined,orgId:null};
  return handleMcpFetchRequest(request,{createServer:()=>createMCPServerForRequest(config,identity,
    {transport:'http',inlineMcpApps:false})});
}
