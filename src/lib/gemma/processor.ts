import {autonomyAt} from '@/lib/agents/runtime';
import {prisma} from '@/lib/db';
import {key,hash,type Scope,type Kind,verifyClinicalOverlay,evaluateClinical,type ClinicalOverlay} from './domain';
import {activity,updateWorkflow,interpretation,currentPolicy,sourceFingerprint,drugFingerprint,type WF,type Data} from './records';
import {createCase} from '@/lib/service/store';
import {DEFAULT_GOALS,type SavingsResult,type SavingsOption} from '@/lib/savings/types';
import {resolveClock} from '@/lib/clock';
import {collectSignals,ensureMonitor} from './monitor';
import type {GemmaSubject,Prisma} from '@/generated/prisma';
const scopeOf=(w:WF)=>({sponsorId:w.sponsorId,contractId:w.contractId});
const accessOf=(w:WF)=>({...scopeOf(w),actor:'Gemma · simulated workflow',at:new Date()});
export async function consumeSignals(scope:Scope){
 const signals=await prisma.gemmaSignal.findMany({where:{...scope,state:'Pending',attempts:{lt:3}},orderBy:[{provenance:'desc'},{createdAt:'asc'}],take:12});
 for(const signal of signals){
 try{
 const input=JSON.parse(signal.payload),sourceKey=key(scope,input.group),id=key(sourceKey,'workflow');
 const group=signal.provenance==='Reference finding'?await prisma.gemmaSignal.findMany({where:{...scope,state:'Pending',payload:{contains:JSON.stringify(input.group)},kind:'access'},take:1000}):[signal];
 let subjects:{memberId:string;memberName:string;claimId:string}[]=[];
 if(signal.kind==='external'){
 subjects=await prisma.$queryRaw<typeof subjects>`SELECT DISTINCT ON (c."memberId") c."memberId",m."firstName"||' '||m."lastName" AS "memberName",c.id AS "claimId" FROM "Claim" c JOIN "Member" m ON m.id=c."memberId" WHERE c."sponsorId"=${scope.sponsorId} AND c."contractId"=${scope.contractId} AND c."drugId"=${input.drugId} AND c."dateOfService"<=${resolveClock(undefined).now.toISOString()}::timestamp ORDER BY c."memberId",c."dateOfService" DESC,c.id`;
 }else if(signal.kind==='access'){
 const claims=await prisma.claim.findMany({where:{...scope,id:{in:group.map(s=>JSON.parse(s.payload).claimId)},dateOfService:{lte:resolveClock(undefined).now}},include:{member:true}});
 const unique=new Map(claims.map(c=>[c.memberId,{memberId:c.memberId,memberName:`${c.member.firstName} ${c.member.lastName}`,claimId:c.id}]));subjects=[...unique.values()];
 }
 const names={access:'Member access review',external:'Documentation criteria review',savings:'Employer savings review'};
 await prisma.$transaction(async tx=>{
 const w=await tx.gemmaWorkflow.upsert({where:{sourceKey},create:{id,...scope,sourceKey,kind:signal.kind,title:names[signal.kind as Kind],team:signal.kind==='external'?'Clinical operations':signal.kind==='savings'?'Account team':'Member services',memberCount:subjects.length,data:JSON.stringify({input,provenance:signal.provenance,generator:input.generator}),evidenceAt:signal.evidenceAt},update:{}});
 for(const s of subjects)await tx.gemmaSubject.upsert({where:{workflowId_memberId:{workflowId:w.id,memberId:s.memberId}},create:{id:key(w.id,s.memberId),workflowId:w.id,...s,evidenceAt:signal.evidenceAt},update:{}});
 await tx.gemmaSignal.updateMany({where:{id:{in:group.map(s=>s.id)}},data:{state:'Processed',workflowId:w.id}});
 },{timeout:30000});
 }catch(e){await prisma.gemmaSignal.update({where:{id:signal.id},data:{attempts:{increment:1},error:e instanceof Error?e.message:'Signal processing failed'}})}
 }
}
async function prepareMessages(w:WF,subjects:GemmaSubject[],template='access-v1'){
 for(const s of subjects){const id=key(w.id,s.memberId,template),value=parseInt(hash(id).slice(0,6),16);await prisma.gemmaCommunication.upsert({where:{id},create:{id,workflowId:w.id,memberId:s.memberId,template,content:template==='access-v1'?`We are reviewing an authorization-related issue with your prescription. Your benefits have not changed. Member services can help with the next step.`:`Your employer approved a benefit-change simulation. This message is part of a simulation; your current benefits have not changed.`,simulationOutcome:value%17===0?'Delivery failure':value%11===0?'No response':value%4===0?'Delivered only':'Acknowledge',preparedAt:new Date()},update:{}})}
}
async function enqueueValidation(w:WF,policyId:string){const id=key(w.id,policyId,'validation');await prisma.job.upsert({where:{id},create:{id,type:'gemma-validate',payload:JSON.stringify({workflowId:w.id,policyId,scope:scopeOf(w)}),maxAttempts:3},update:{}});return id;}
export async function advanceWorkflow(w:WF){
 let data=JSON.parse(w.data) as Data;const scope=scopeOf(w),subjects=await prisma.gemmaSubject.findMany({where:{workflowId:w.id}});
 if(w.status==='Detected'){
 await activity(w,'detected','Detected',`${data.provenance}. ${w.memberCount} affected members identified.`, 'gemma',{provenance:data.provenance});
 return updateWorkflow(w,'Investigating',data,'Gemma routed the signal to the responsible specialist.','gemma','route');
 }
 if(w.status==='Investigating'){
 const thought=await interpretation(w.kind as Kind,{provenance:data.provenance,members:w.memberCount});await activity(w,'interpretation','Investigating',thought.value.summary,w.kind==='external'?'gemma-market':w.kind==='savings'?'gemma-employer':'gemma-member',thought.value,thought);
 if(w.kind==='access'){
 const fingerprints:Record<string,string>={},policies:Record<string,string|null>={};
 for(const s of subjects){fingerprints[s.claimId]=await sourceFingerprint(s.claimId);const c=await prisma.claim.findUniqueOrThrow({where:{id:s.claimId}});policies[c.drugId]=(await currentPolicy(scope,'clinical',c.drugId,new Date()))?.id??null;const caseId=await createCase(accessOf(w),{requestId:key(w.id,s.memberId,'case'),memberId:s.memberId,kind:'authorization',claimId:s.claimId});await prisma.gemmaSubject.update({where:{id:s.id},data:{caseId}});}
 data={...data,fingerprints,policies,benefitPolicyId:(await currentPolicy(scope,'benefit','employer',new Date()))?.id??null,proposal:{kind:'access',claimIds:subjects.map(s=>s.claimId),authorization:'Simulated clinical review approval only; a paid replay result is still required.'}};
 }else if(w.kind==='external'){
 const input=data.input as {drugId:string};const previous=await currentPolicy(scope,'clinical',input.drugId,new Date());
 data={...data,sourceHash:await drugFingerprint(input.drugId),proposal:{rule:'prescriber-confirmation',drugId:input.drugId,previousPolicyId:previous?.id??null},clinicalMeaning:'Synthetic requirement for documented prescriber confirmation. Demonstrates implementation, not a medical recommendation.'};
 }else{
 const at=resolveClock(undefined).now,from=new Date(at.getTime()-7*86400000),prior=new Date(at.getTime()-14*86400000);
 const [recent,before]=await Promise.all([prisma.claim.aggregate({where:{...scope,dateOfService:{gte:from,lte:at}},_sum:{planPaidCents:true},_count:true}),prisma.claim.aggregate({where:{...scope,dateOfService:{gte:prior,lt:from}},_sum:{planPaidCents:true},_count:true})]);
 const trend={currentCents:recent._sum.planPaidCents??0,previousCents:before._sum.planPaidCents??0,currentClaims:recent._count,previousClaims:before._count,from:from.toISOString(),cutoff:at.toISOString()};
 if(scope.sponsorId!=='steel-potatoes'||scope.contractId!=='etg0013')throw Error('Savings replay is configured only for the Steel Potatoes reference book.');
 if(!recent._count)return updateWorkflow(w,'Blocked',{...data,trend},'No eligible claims in the comparison period.','gemma-employer','no-population');
 const jobId='sav_'+hash([scope,'gemma-savings',at.toISOString().slice(0,10)]).slice(0,32);await prisma.job.upsert({where:{id:jobId},create:{id:jobId,type:'savings-v1',payload:JSON.stringify({cutoff:at.toISOString(),goals:{...DEFAULT_GOALS,allowHigherCost:true},sponsor:scope.sponsorId,contract:scope.contractId}),maxAttempts:2},update:{}});
 await prisma.gemmaWorkflow.update({where:{id:w.id},data:{savingsJobId:jobId}});data={...data,trend};
 return updateWorkflow(w,'Analyzing',data,'Cost trend recorded. The savings worker is comparing options on a fixed 1% sample.','plan-design','savings-queued');
 }
 return updateWorkflow(w,'Action prepared',data,w.kind==='external'?'Versioned clinical proposal prepared for simulated review.':'Service cases and an authorization-review packet prepared.','gemma-operations','prepared');
 }
 if(w.status==='Analyzing'){
 const job=await prisma.job.findUnique({where:{id:w.savingsJobId!}});if(job?.status==='failed')return updateWorkflow(w,'Failed',{...data,error:job.error},'Savings analysis failed; no recommendation applied.','plan-design','savings-failed');
 if(job?.status!=='succeeded'||!job.result)return;
 const result=JSON.parse(job.result) as SavingsResult,option=result.options.find(o=>o.id===result.recommendedId);
 if(!option)return updateWorkflow(w,'Blocked',{...data,result},'No tested option meets the saved goals.','plan-design','no-recommendation');
 // Freeze the selected option; all amounts remain sample results, never extrapolated.
 data={...data,resultHash:hash(result),proposal:{optionId:option.id,override:option.override,previousPolicyId:(await currentPolicy(scope,'benefit','employer',new Date()))?.id??null},option,resultPopulation:{claims:result.claimsEvaluated,members:result.membersEvaluated,sampleRate:result.sampleRate,cutoff:result.cutoff}};
 await prisma.$transaction(async tx=>{for(const s of option.disruptions){const m=await tx.member.findFirst({where:{id:s.memberId,sponsorId:scope.sponsorId}});if(!m)throw Error('Savings member scope mismatch');await tx.gemmaSubject.upsert({where:{workflowId_memberId:{workflowId:w.id,memberId:s.memberId}},create:{id:key(w.id,s.memberId),workflowId:w.id,memberId:s.memberId,memberName:s.memberName,claimId:s.claimIds[0],evidenceAt:new Date()},update:{}})}await tx.gemmaWorkflow.update({where:{id:w.id},data:{memberCount:option.disruptions.length}})},{timeout:30000});
 return updateWorkflow(w,'Action prepared',data,'Savings, unique disrupted members and modeled NPS recorded. Employer review is required.','gemma-employer','savings-prepared');
 }
 if(w.status==='Action prepared'){
 if(w.kind==='access'){await prepareMessages(w,subjects);await activity(w,'messages-prepared','Action prepared','Approved-template messages prepared for the simulated inbox.','gemma-communications',{template:'access-v1',members:subjects.length});}
 const proposalHash=hash({kind:w.kind,proposal:data.proposal,fingerprints:data.fingerprints,policies:data.policies,sourceHash:data.sourceHash,resultHash:data.resultHash,benefitPolicyId:data.benefitPolicyId});
 // Hash and status are committed together with the gate record.
 await prisma.$transaction(async tx=>{const changed=await tx.gemmaWorkflow.updateMany({where:{id:w.id,revision:w.revision},data:{proposalHash,status:'Awaiting approval',revision:{increment:1},updatedAt:new Date()}});if(!changed.count)throw Error('Workflow changed');await tx.gemmaActivity.upsert({where:{key:key(w.id,'approval-gate')},create:{id:key(w.id,'approval-gate'),key:key(w.id,'approval-gate'),workflowId:w.id,type:'approval-gate',status:'Awaiting approval',summary:'Simulated approval required for this exact proposal version.',agentId:'gemma',payload:JSON.stringify({proposalHash,team:w.team}),evidenceAt:new Date()},update:{}})});
 return;
 }
 if(w.status==='Approved'){
 const policy=await prisma.gemmaPolicy.findFirstOrThrow({where:{workflowId:w.id,contentHash:w.proposalHash!}});const jobId=await enqueueValidation(w,policy.id);
 return updateWorkflow(w,'Validating',{...data,validationJobId:jobId,policyId:policy.id},'Reviewed version queued for validation. It is not effective yet.','gemma-clinical','validation-queued');
 }
 if(w.status==='Validating'){
 if(!['Act','ActWithReview'].includes(await autonomyAt('gemma-operations',new Date())))throw Error('Operations autonomy does not permit sandbox application.');
 const job=await prisma.job.findUnique({where:{id:String(data.validationJobId)}});if(!job||['pending','running'].includes(job.status))return;
 const result=job.result?JSON.parse(job.result):{passed:false,error:job.error};
 if(!result.passed){await prisma.gemmaPolicy.update({where:{id:String(data.policyId)},data:{status:'Failed',validation:JSON.stringify(result)}});return updateWorkflow(w,'Blocked',{...data,validation:result},'Validation did not pass. No policy or benefit version was activated.','gemma-clinical','validation-blocked');}
 await assertSources(w);
 // Publish only a validated, reviewed version. Operational configuration is never updated.
 await prisma.$transaction(async tx=>{const current=await tx.gemmaWorkflow.findUniqueOrThrow({where:{id:w.id}});if(current.revision!==w.revision||current.proposalHash!==w.proposalHash)throw Error('Approved version changed');await tx.gemmaPolicy.update({where:{id:String(data.policyId)},data:{status:'Active',effectiveAt:new Date(),validation:JSON.stringify(result)}})});
 return updateWorkflow(w,'Applied',{...data,validation:result},'Validated version activated in the isolated Gemma simulation.','gemma-operations','applied');
 }
 if(w.status==='Applied'){
 const policy=await prisma.gemmaPolicy.findUniqueOrThrow({where:{id:String(data.policyId)}});if(policy.status!=='Active')throw Error('Policy is not effective');
 if(w.kind==='external'){
 const test=verifyClinicalOverlay(JSON.parse(policy.payload));if(!test.passed)throw Error('Post-application retest failed');
 return updateWorkflow(w,'Verified',{...data,retest:test},'Clinical overlay retested: missing evidence blocks, complete evidence passes, unrelated drugs remain unchanged. Clinical appropriateness is not asserted.','gemma-clinical','verified');
 }
 if(w.kind==='access'){
 const validation=data.validation as {members:{memberId:string;claimId:string;passed:boolean;after:unknown}[]};
 for(const s of subjects){const result=validation.members.find(x=>x.memberId===s.memberId&&x.claimId===s.claimId);if(!result?.passed)throw Error('Missing member validation');await recordServiceOutcome(w,s,result);}
 const messages=await prisma.gemmaCommunication.findMany({where:{workflowId:w.id}});if(messages.some(m=>!m.acknowledgedAt))return; // Waiting remains explicit until separate simulator events arrive.
 for(const s of subjects)await resolveService(w,s);
 return updateWorkflow(w,'Verified',data,'All linked sandbox fill checks passed and simulated member acknowledgments were recorded.','gemma-member','verified');
 }
 // Prepare support once per member; reuse the saved analysis rather than re-running the employer analysis.
 for(const s of subjects){if(s.caseId)continue;await createSupportDraft(w,s,data);}
 await prepareMessages(w,subjects,'benefit-v1');
 const messages=await prisma.gemmaCommunication.findMany({where:{workflowId:w.id}});if(messages.some(m=>!m.deliveredAt))return;
 return updateWorkflow(w,'Verified',data,'Benefit overlay validation passed, support cases were prepared and simulated delivery was recorded. Savings remain modeled.','gemma-employer','verified');
 }
}
export async function assertSources(w:WF){
 const d=JSON.parse(w.data),scope=scopeOf(w);
 if(w.kind==='access'){if(((await currentPolicy(scope,'benefit','employer',new Date()))?.id??null)!==d.benefitPolicyId)throw Error('Benefit policy changed after preparation. Recheck required.');for(const [id,value] of Object.entries(d.fingerprints??{}))if(await sourceFingerprint(id)!==value)throw Error('Reference claim changed after preparation. Recheck before reviewing.');for(const [drug,id]of Object.entries(d.policies??{}))if(((await currentPolicy(scope,'clinical',drug,new Date()))?.id??null)!==id)throw Error('Clinical policy changed after preparation. Recheck required.');}
 if(w.kind==='external'){if(await drugFingerprint(d.proposal.drugId)!==d.sourceHash)throw Error('Reference formulary changed. Recheck required.');const p=await currentPolicy(scope,'clinical',d.proposal.drugId,new Date());if((p?.id??null)!==d.proposal.previousPolicyId&&p?.workflowId!==w.id)throw Error('A newer clinical version superseded this proposal.');}
 if(w.kind==='savings'){const job=await prisma.job.findUniqueOrThrow({where:{id:w.savingsJobId!}});if(!job.result||hash(JSON.parse(job.result))!==d.resultHash)throw Error('Savings analysis changed. Recheck required.');const p=await currentPolicy(scope,'benefit','employer',new Date());if((p?.id??null)!==d.proposal.previousPolicyId&&p?.workflowId!==w.id)throw Error('A newer benefit version superseded this proposal.');}
}
async function recordServiceOutcome(w:WF,s:GemmaSubject,result:unknown){
 if(!s.caseId)throw Error('Missing service case');const eventId=key(w.id,s.id,'service-outcome');
 const policy=await prisma.gemmaPolicy.findUniqueOrThrow({where:{id:String(JSON.parse(w.data).policyId)}});
 await prisma.$transaction(async tx=>{
 if(await tx.memberServiceEvent.findUnique({where:{id:eventId}}))return;
 const c=await tx.memberServiceCase.findUniqueOrThrow({where:{id:s.caseId!}});
 const changed=await tx.memberServiceCase.updateMany({where:{id:c.id,revision:c.revision},data:{revision:{increment:3},status:'In progress',updatedAt:new Date()}});if(!changed.count)throw Error('Service case changed. Retry required.');
 const events=[{type:'approve',summary:'Linked Gemma review approved this exact sandbox authorization version.',actor:policy.approvedBy},{type:'authorization-response',summary:'Synthetic prescriber and authorization response recorded for the selected drug.',actor:'Gemma · simulator'},{type:'fill-response',summary:'Reviewed authorization overlay produced a paid replay for the linked claim. No real fill occurred.',actor:'Gemma · outcome verifier'}];
 for(let i=0;i<events.length;i++)await tx.memberServiceEvent.create({data:{id:i===2?eventId:key(eventId,i),caseId:c.id,seq:c.revision+i+1,status:'In progress',team:'Member services',...events[i],simulated:true,evidenceAt:new Date(),payload:JSON.stringify({workflowId:w.id,result,policyId:policy.id,simulated:true})}});
 });
}
async function resolveService(w:WF,s:GemmaSubject){
 if(!s.caseId)return;await prisma.$transaction(async tx=>{const eventId=key(w.id,s.id,'resolved');if(await tx.memberServiceEvent.findUnique({where:{id:eventId}}))return;const c=await tx.memberServiceCase.findUniqueOrThrow({where:{id:s.caseId!}});const last=await tx.memberServiceEvent.findFirst({where:{caseId:c.id},orderBy:{seq:'desc'}});if(last?.type!=='fill-response')return;const changed=await tx.memberServiceCase.updateMany({where:{id:c.id,revision:c.revision},data:{revision:{increment:1},status:'Resolved',updatedAt:new Date()}});if(!changed.count)throw Error('Service case changed.');await tx.memberServiceEvent.create({data:{id:eventId,caseId:c.id,seq:c.revision+1,type:'resolve',status:'Resolved',team:'Member services',summary:'Access restored in simulation: linked paid replay and simulated member acknowledgment recorded.',actor:'Gemma · outcome verifier',simulated:true,evidenceAt:new Date(),payload:JSON.stringify({workflowId:w.id})}})});
}
async function createSupportDraft(w:WF,s:GemmaSubject,data:Data){
 const c=await prisma.claim.findUniqueOrThrow({where:{id:s.claimId},include:{drug:true,benefitPlan:true}}),o=data.option as SavingsOption;const id=key(w.id,s.id,'support'),sessionId=key(id,'chat');
 await prisma.$transaction(async tx=>{
 await tx.chatSession.upsert({where:{id:sessionId},create:{id:sessionId,memberId:s.memberId,title:'Benefit change support'},update:{}});
 await tx.memberServiceCase.upsert({where:{id},create:{id,...scopeOf(w),memberId:s.memberId,memberName:s.memberName,title:'Benefit change support',kind:'benefit',team:'Member services',sessionId,sourceKey:id,evidenceAt:new Date(),context:JSON.stringify({claimId:c.id,claimNumber:c.claimNumber,drugId:c.drugId,drugName:c.drug.name,benefitPlanId:c.benefitPlanId,benefitName:c.benefitPlan.name,patientPayCents:c.patientPayCents,rejectReason:c.rejectMessage,gemmaWorkflowId:w.id,source:{runId:w.savingsJobId,optionId:o.id,title:o.title,claimIds:o.disruptions.find(x=>x.memberId===s.memberId)?.claimIds??[c.id],higherCost:o.disruptions.find(x=>x.memberId===s.memberId)?.higherCost??false,accessChange:o.disruptions.find(x=>x.memberId===s.memberId)?.accessChange??false,beforeCents:null,afterCents:null,deltaCents:null,override:o.override}})},update:{}});
 await tx.memberServiceEvent.upsert({where:{id:key(id,'created')},create:{id:key(id,'created'),caseId:id,seq:0,type:'created',status:'Open',team:'Member services',summary:'Gemma prepared member support for a reviewed sandbox benefit version. Individual cost estimate is not yet calculated.',actor:'Gemma',simulated:true,evidenceAt:new Date()},update:{}});
 await tx.gemmaSubject.update({where:{id:s.id},data:{caseId:id}});
 });
}
export async function simulateCommunications(scope:Scope,now=new Date()){
 if(!['Act','ActWithReview'].includes(await autonomyAt('gemma-communications',now)))return;
 const messages=await prisma.gemmaCommunication.findMany({where:{workflow:{...scope},OR:[{status:'Prepared'},{status:'Sent',simulationOutcome:{not:'No response'}},{status:'Delivered',simulationOutcome:'Acknowledge'}]},orderBy:{preparedAt:'asc'},take:100});
 for(const m of messages){const w=await prisma.gemmaWorkflow.findUniqueOrThrow({where:{id:m.workflowId}});let patch:Prisma.GemmaCommunicationUpdateInput|null=null,type='';
 if(m.status==='Prepared'){patch={status:'Sent',sentAt:now};type='sent';}
 else if(m.status==='Sent'&&m.sentAt&&now.getTime()-m.sentAt.getTime()>=30000&&m.simulationOutcome!=='No response'){patch=m.simulationOutcome==='Delivery failure'?{status:'Failed',failedAt:now}:{status:'Delivered',deliveredAt:now};type=m.simulationOutcome==='Delivery failure'?'failed':'delivered';}
 else if(m.status==='Delivered'&&m.deliveredAt&&now.getTime()-m.deliveredAt.getTime()>=60000&&m.simulationOutcome==='Acknowledge'){patch={status:'Acknowledged',acknowledgedAt:now};type='acknowledged';}
 if(!patch)continue;
 await prisma.$transaction(async tx=>{const changed=await tx.gemmaCommunication.updateMany({where:{id:m.id,status:m.status},data:patch!});if(!changed.count)return;await tx.gemmaActivity.upsert({where:{key:key(m.id,type,w.revision)},create:{id:key(m.id,type,w.revision),key:key(m.id,type,w.revision),workflowId:w.id,type:'communication-'+type,status:w.status,summary:`Simulated inbox message ${type}.`,agentId:'gemma-communications',payload:JSON.stringify({messageId:m.id,memberId:m.memberId,simulated:true}),evidenceAt:now},update:{}})});
 }
}
export async function processTick(scope:Scope){
 if(await autonomyAt('gemma',new Date())==='Suspended')throw Error('Gemma is suspended.');
 const monitor=await ensureMonitor(scope);if(!monitor.enabled)return {paused:true};
 await collectSignals(scope);await consumeSignals(scope);
 const work=await prisma.gemmaWorkflow.findMany({where:{...scope,status:{in:['Detected','Investigating','Action prepared','Analyzing','Approved','Validating','Applied']}},orderBy:{updatedAt:'asc'},take:12});
 for(const w of work){try{let current=w;for(let i=0;i<4;i++){await advanceWorkflow(current);const next=await prisma.gemmaWorkflow.findUniqueOrThrow({where:{id:current.id}});if(next.revision===current.revision||['Awaiting approval','Verified','Failed','Blocked','Rejected'].includes(next.status))break;current=next;}await prisma.gemmaWorkflow.updateMany({where:{id:w.id,revision:w.revision},data:{updatedAt:new Date()}})}catch(e){const message=e instanceof Error?e.message:'Workflow failed';const current=await prisma.gemmaWorkflow.findUniqueOrThrow({where:{id:w.id}});if(!['Verified','Rejected','Awaiting approval'].includes(current.status))await updateWorkflow(current,'Failed',{...JSON.parse(current.data),error:message},message,'gemma','failed-'+current.revision);}}
 await simulateCommunications(scope);
 await prisma.gemmaMonitor.update({where:{id:monitor.id},data:{checkedAt:new Date(),heartbeatAt:new Date(),lastError:null}});
 return {processed:work.length};
}
