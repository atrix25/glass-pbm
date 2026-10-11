import {prisma} from '@/lib/db';
import {replay,type ConfigOverride} from '@/lib/engine/replay';
import {assertSources} from './processor';
import {currentPolicy} from './records';
import {evaluateClinical,verifyClinicalOverlay,type Scope,type ClinicalOverlay} from './domain';
import type {SavingsOption} from '@/lib/savings/types';
export async function validateGemma(input:{workflowId:string;policyId:string;scope:Scope}){
 if(input.scope.sponsorId!=='steel-potatoes'||input.scope.contractId!=='etg0013')throw Error('Replay is not configured for this reference book.');
 const w=await prisma.gemmaWorkflow.findFirstOrThrow({where:{id:input.workflowId,...input.scope}}),p=await prisma.gemmaPolicy.findFirstOrThrow({where:{id:input.policyId,workflowId:w.id,...input.scope}});
 if(p.status!=='Approved'||p.contentHash!==w.proposalHash||!['Approved','Validating'].includes(w.status))throw Error('No current approved policy to validate.');
 await assertSources(w);const data=JSON.parse(w.data),at=new Date();
 if(w.kind==='external'){const policy=JSON.parse(p.payload) as ClinicalOverlay,test=verifyClinicalOverlay(policy);const subjects=await prisma.gemmaSubject.findMany({where:{workflowId:w.id}});const affected=subjects.map(s=>({memberId:s.memberId,claimId:s.claimId,missingEvidenceBlocked:!evaluateClinical(policy,{drugId:policy.drugId,prescriberConfirmation:false,authorizationApproved:true}).canProceed,completeEvidencePermitted:evaluateClinical(policy,{drugId:policy.drugId,prescriberConfirmation:true,authorizationApproved:true}).canProceed}));return {...test,passed:test.passed&&affected.length>0&&affected.every(x=>x.missingEvidenceBlocked&&x.completeEvidencePermitted),affected,scope:input.scope,policyHash:p.contentHash,engine:'gemma-documentation-v1',simulated:true};}
 if(w.kind==='savings'){
 const o=data.option as SavingsOption,cutoff=new Date(data.resultPopulation.cutoff);
 const baseline=await replay({}, {asOf:cutoff,sampleRate:0.01,maxDiffs:0});if(baseline.claimsChanged)throw Error('Reference baseline no longer reproduces.');
 const actual=await replay(o.override,{asOf:cutoff,sampleRate:0.01,maxDiffs:0,nps:true,trackDisruption:true});
 const savings=actual.planPaidBeforeCents-actual.rebateBeforeCents-(actual.planPaidAfterCents-actual.rebateAfterCents);
 const passed=savings===o.savingsCents&&actual.memberDisruptions?.length===o.disruptions.length&&actual.newRejects===0&&actual.nps?.after.census.nps===o.npsAfter;
 return {passed,policyHash:p.contentHash,engine:'existing-adjudication-replay',simulated:true,savingsCents:savings,membersDisrupted:actual.memberDisruptions?.length,npsAfter:actual.nps?.after.census.nps,claims:actual.claimsEvaluated,sampleRate:0.01,checks:[{name:'Saved savings reproduce',passed:savings===o.savingsCents},{name:'Disruption count reproduces',passed:actual.memberDisruptions?.length===o.disruptions.length},{name:'No new rejected fills',passed:actual.newRejects===0}]};
 }
 const subjects=await prisma.gemmaSubject.findMany({where:{workflowId:w.id}});const members=[];
 const benefit=await currentPolicy(input.scope,'benefit','employer',at);const override:ConfigOverride=benefit?JSON.parse(benefit.payload).override:{};
 for(const s of subjects){
 const c=await prisma.claim.findFirstOrThrow({where:{id:s.claimId,memberId:s.memberId,...input.scope}});
 const clinical=await currentPolicy(input.scope,'clinical',c.drugId,at);
 // The simulated prescriber response is an explicit test input, not inferred from message acknowledgment.
 const prescriberConfirmation=true;
 const gate=evaluateClinical(clinical?JSON.parse(clinical.payload) as ClinicalOverlay:null,{drugId:c.drugId,prescriberConfirmation,authorizationApproved:true});
 const result=await replay(override,{memberId:s.memberId,asOf:c.dateOfService,maxDiffs:1000,sandboxPA:{memberId:s.memberId,drugId:c.drugId,effectiveDate:c.dateOfService,terminationDate:new Date(c.dateOfService.getTime()+86400000)}});
 const diff=result.diffs.find(d=>d.claimId===c.id);const paid=diff?.after.status==='P';
 members.push({memberId:s.memberId,claimId:c.id,passed:gate.canProceed&&paid,after:diff?.after??null,reason:paid?null:'Reference fill still does not pay under the reviewed sandbox inputs.',prescriberEvidence:{simulated:true,confirmed:prescriberConfirmation},clinicalPolicyId:clinical?.id??null,benefitPolicyId:benefit?.id??null,gate});
 }
 return {passed:members.length>0&&members.every(m=>m.passed),members,policyHash:p.contentHash,engine:'existing-adjudication-replay',simulated:true};
}
