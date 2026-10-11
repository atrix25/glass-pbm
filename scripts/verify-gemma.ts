import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prisma} from '../src/lib/db';
import {ensureMonitor,deploymentScope,collectSignals} from '../src/lib/gemma/monitor';
import {consumeSignals,advanceWorkflow,simulateCommunications} from '../src/lib/gemma/processor';
import {review,detail,overview,respond} from '../src/lib/gemma/store';
import {validateGemma} from '../src/lib/gemma/validate';
import {runSavings} from '../src/lib/savings/run';
import {key} from '../src/lib/gemma/domain';
import {claimNextJob,completeJob} from '../src/lib/jobs';
const scope=deploymentScope(),a={...scope,actor:'Demo reviewer · verification',at:new Date()},prefix=randomUUID();
async function advance(id:string){let w=await prisma.gemmaWorkflow.findUniqueOrThrow({where:{id}});await advanceWorkflow(w);return prisma.gemmaWorkflow.findUniqueOrThrow({where:{id}})}
async function main(){
 const monitor=await ensureMonitor(scope);console.log('Reference population',monitor.population,monitor.claims);assert(monitor.population>=100000);
 const claim=await prisma.claim.findFirstOrThrow({where:{...scope,responseStatus:'R',rejectCodes:{contains:'75'},dateOfService:{lte:a.at}},orderBy:{id:'asc'}});
 const before=await prisma.claim.findUnique({where:{id:claim.id}});
 const ids:string[]=[];
 for(const kind of ['external','access','savings']){
 const id=key(prefix,kind);ids.push(id);await prisma.gemmaSignal.create({data:{id,...scope,sourceKey:id,kind,provenance:'Synthetic event',payload:JSON.stringify({claimId:claim.id,drugId:claim.drugId,group:id,event:'Explicit verification scenario',generator:'gemma-verification-v1'}),evidenceAt:new Date()}});
 }
 await consumeSignals(scope);await consumeSignals(scope);
 for(const signalId of ids){
 const signal=await prisma.gemmaSignal.findUniqueOrThrow({where:{id:signalId}});assert(signal.workflowId,signal.error??'Missing workflow');let w=await advance(signal.workflowId);w=await advance(w.id);
 if(w.status==='Analyzing'){
 const job=await prisma.job.findUniqueOrThrow({where:{id:w.savingsJobId!}});if(job.status!=='succeeded'){await prisma.job.update({where:{id:job.id},data:{status:'running',leaseOwner:'verification',leaseUntil:new Date(Date.now()+300000)}});const result=await runSavings(JSON.parse(job.payload));await prisma.job.update({where:{id:job.id},data:{status:'succeeded',result:JSON.stringify(result)}});}w=await advance(w.id);
 }
 w=await advance(w.id);assert.equal(w.status,'Awaiting approval',JSON.stringify(w));
 const atGate=new Date();const input={requestId:randomUUID(),revision:w.revision,proposalHash:w.proposalHash!,decision:'Approve' as const,note:'Verified sandbox-only review.'};
 await assert.rejects(review({...a,sponsorId:'another-sponsor'},w.id,input));await assert.rejects(review(a,w.id,{...input,revision:w.revision+1}));
 const d=await review(a,w.id,input);assert.equal((await review(a,w.id,input)).id,d.id);assert.equal(await prisma.gemmaPolicy.count({where:{workflowId:w.id}}),1);
 w=await advance(w.id);assert.equal(w.status,'Validating');const data=JSON.parse(w.data);const result=await validateGemma({workflowId:w.id,policyId:data.policyId,scope});console.log(w.kind,'validation',JSON.stringify(result).slice(0,1500));
 assert(result.passed,'Validation must actually pass for complete journey');await prisma.job.update({where:{id:data.validationJobId},data:{status:'succeeded',result:JSON.stringify(result)}});w=await advance(w.id);assert.equal(w.status,'Applied');w=await advance(w.id);
 // Explicitly simulate responses at advancing recorded times; deterministic failures remain unresolved.
 const now=new Date();await simulateCommunications(scope,now);
 w=await advance(w.id);console.log(w.kind,w.status,w.id);
 const history=await detail({...a,at:atGate},w.id,new URLSearchParams(),true);assert.equal(history.status,'Awaiting approval');assert(history.decisions.length===0);assert(history.messages.every(m=>m.acknowledgedAt===null));
 const once=await prisma.gemmaCommunication.count({where:{workflowId:w.id}});if(w.status==='Applied')await advance(w.id);assert.equal(await prisma.gemmaCommunication.count({where:{workflowId:w.id}}),once);
 assert(['Applied','Verified'].includes(w.status));
 for(const m of await prisma.gemmaCommunication.findMany({where:{workflowId:w.id}})){
 let state=m.status;
 if(state==='Failed'){w=await prisma.gemmaWorkflow.findUniqueOrThrow({where:{id:w.id}});await respond(a,w.id,m.id,{requestId:randomUUID(),revision:w.revision,command:'retry'});await simulateCommunications(scope,new Date());state='Sent';}
 if(state==='Sent'){w=await prisma.gemmaWorkflow.findUniqueOrThrow({where:{id:w.id}});await respond(a,w.id,m.id,{requestId:randomUUID(),revision:w.revision,command:'deliver'});state='Delivered';}
 if(state==='Delivered'){w=await prisma.gemmaWorkflow.findUniqueOrThrow({where:{id:w.id}});await respond(a,w.id,m.id,{requestId:randomUUID(),revision:w.revision,command:'acknowledge'});}
 }
 w=await advance(w.id);assert.equal(w.status,'Verified');console.log(w.kind,'verified after recorded responses');
 }
 assert.deepEqual(await prisma.claim.findUnique({where:{id:claim.id}}),before);
 const list=await overview({...a,at:new Date(Date.now()+180000)},new URLSearchParams('status=Awaiting approval'));assert.equal(list.total,list.awaiting);
 // A stale owner's completion cannot publish a result; another queue cannot claim Gemma's work.
 const jid=key(prefix,'lease');await prisma.job.create({data:{id:jid,type:'gemma-tick',payload:'{}',status:'running',attempts:1,leaseOwner:'dead-worker',leaseUntil:new Date(Date.now()-1000)}});
 await assert.rejects(completeJob(jid,{incorrect:true},'dead-worker'));
 const recovered=await claimNextJob('verification','gemma');assert(recovered);assert.equal(recovered.id,jid);await completeJob(jid,{recovered:true},'verification');
 console.log('Gemma verification passed: three journeys, idempotent decisions, scope, cutoff, communications, isolated claims and stale-lease recovery.');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
