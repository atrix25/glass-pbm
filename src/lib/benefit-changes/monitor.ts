import {prisma} from '@/lib/db';
import {adjudicate,type AdjudicationContext} from '@/lib/engine/adjudicate';
import {loadWorld,applyPlanOverride,applyFormularyOverride,type ConfigOverride} from '@/lib/engine/replay';
import type {ChangeData,TestResult} from './types';
// Reference records supply templates only. New claims are isolated synthetic events.
export async function simulateClaims(scope:{sponsorId:string;contractId:string},d:ChangeData,active:ConfigOverride,fault:boolean){
 const world=await loadWorld(),at=new Date();
 const claims=await prisma.claim.findMany({where:{...scope,transactionCode:'B1',responseStatus:'P',dateOfService:{lte:new Date(d.cutoff)},...(d.proposal.kind==='pa'?{drugId:d.proposal.drugId}:d.proposal.kind==='specialty'?{formularyLevel:'4'}:{formularyLevel:'1'})},orderBy:{id:'asc'},take:5,skip:(d.outcomes.length%5)*5});
 const results:TestResult[]=[],inputs:unknown[]=[];
 for(const c of claims){const drug=world.drugs.get(c.drugId),member=world.members.get(c.memberId),elig=world.eligibility.get(c.memberId),pharmacy=world.pharmacies.get(c.pharmacyId),entry=world.formulary.get(c.drugId);const plan=elig?world.plans.get(elig.benefitPlanId):null;if(!drug||!member||!elig||!pharmacy||!plan||!entry)continue;
 const request={dateOfService:at,cardholderId:'SIMULATED',personCode:'01',serviceProviderId:pharmacy.npi,productServiceId:drug.ndc11,rxNumber:'SIM-'+c.rxNumber,fillNumber:0,quantityDispensed:c.quantityDispensed,daysSupply:c.daysSupply,dawCode:c.dawCode,usualAndCustomaryCents:c.usualAndCustomaryCents,ingredientCostSubmittedCents:c.ingredientCostSubmittedCents};
 const make=(o:ConfigOverride):AdjudicationContext=>({request,member:{id:c.memberId,diagnosisCodes:member.diagnosisCodes,weightKg:member.weightKg},eligibility:elig,pharmacy,drug,plan:applyPlanOverride(plan,o),formularyEntry:applyFormularyOverride(entry,drug.name,drug.id,o),contract:world.contract,priorFills:[],approvedPAs:[],accumulators:{rxOopAccumulatedCents:0,federalOopAccumulatedCents:0,deductibleAccumulatedCents:0}});
 const summarize=(o:ReturnType<typeof adjudicate>)=>({status:o.responseStatus,memberCents:o.patientPayCents,planCents:o.planPaidCents,reject:o.rejectCodes[0]??null});
 const expected=summarize(adjudicate(make(d.override))),out=adjudicate(make(active)),produced=summarize(out),baseline=summarize(adjudicate(make(d.baseline)));
 // A labeled transport fault, after adjudication, exercises the independent output comparison.
 if(fault)produced.memberCents+=100;
 results.push({name:'Simulated claim · '+c.claimNumber,expected,produced,passed:JSON.stringify(expected)===JSON.stringify(produced)});
 inputs.push({context:make(active),sourceClaimId:c.id,memberId:c.memberId,drugId:c.drugId,drugName:drug.name,request,baseline,trace:out.trace,assumptions:'Synthetic new fill, zero starting accumulators, no prior fills or PA. Not a recorded member encounter.'});
 }
 if(!results.length)results.push({name:'Eligible source templates',expected:'At least one complete claim template',produced:'Missing source evidence',passed:false});
 return {results,inputs};
}

export function reprocessBatch(batch:ChangeData['outcomes'][number]):TestResult[]{
 return (batch.inputs??[]).map((input,index)=>{
  const record=input as {context?:AdjudicationContext};if(!record.context)return {name:'Original input unavailable',expected:'Recorded claim input',produced:null,passed:false};
  const ctx=structuredClone(record.context);ctx.request.dateOfService=new Date(ctx.request.dateOfService);if(ctx.eligibility){ctx.eligibility.effectiveDate=new Date(ctx.eligibility.effectiveDate);if(ctx.eligibility.terminationDate)ctx.eligibility.terminationDate=new Date(ctx.eligibility.terminationDate);}
  const out=adjudicate(ctx),produced={status:out.responseStatus,memberCents:out.patientPayCents,planCents:out.planPaidCents,reject:out.rejectCodes[0]??null},expected=batch.results[index].expected;
  return {name:batch.results[index].name+' · corrected reprocessing',expected,produced,passed:JSON.stringify(expected)===JSON.stringify(produced)};
 });
}
