import { createHash } from 'node:crypto';
import type { Evidence, Entry } from '../contract-checks/detector';
import type { SponsorKey } from '../contract-checks/profiles';
import type { AnswerKey, ChallengePackage } from './types';
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Seeded challenge agent. No detector or evaluator dependency. All records are synthetic. */
export function inject(sponsor:SponsorKey,seed:string,salt:string,claimCount=200,faultCount=24):ChallengePackage {
 if(![200,1000].includes(claimCount)||faultCount<0||faultCount>claimCount-20)throw Error('Invalid challenge size');
 let state=parseInt(createHash('sha256').update(seed).digest('hex').slice(0,8),16)||1;
 const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
 const token=()=>Math.floor(random()*0xffffffff).toString(16).padStart(8,'0');
 const year=sponsor==='tennessee'?2022:2024;
 const at=`${year}-01-15T00:00:00.000Z`,posted=`${year}-02-01T00:00:00.000Z`,cutoff=`${year}-06-30T00:00:00.000Z`;
 const input:Evidence={sponsor,version:'blind-input-v1',claims:[],terms:[],submissions:[],receipts:[],credits:[],guaranteeCredits:[]};
 for(let i=0;i<claimCount;i++){
  const id=`claim-${token()}-${i}`,drug=`drug-${token()}-${i}`,units=1+Math.floor(random()*3),rate=5000+Math.floor(random()*45001);
  const excluded=i>=claimCount-10&&i%2===0,withinTerms=i>=claimCount-10&&!excluded;
  const claim={id,drug,units,serviceAt:at,recordedAt:at,manufacturerEligible:!excluded,clientEligible:true};input.claims.push(claim);
  const sub=sponsor==='wisconsin'?{referenceWacCents:100000,productWacCents:60000}:undefined;
  input.terms.push({id:`term-${token()}-${i}`,drug,from:`${year}-01-01T00:00:00.000Z`,to:`${year}-12-31T23:59:59.999Z`,recordedAt:`${year}-01-01T00:00:00.000Z`,manufacturerRateCents:rate,guaranteeRateCents:10000,invoiceDue:`${year}-03-01T00:00:00.000Z`,receiptDue:`${year}-${withinTerms?'12':'04'}-01T00:00:00.000Z`,creditDue:`${year}-05-01T00:00:00.000Z`,substitution:sub,citation:'Synthetic challenge terms v1 · assumed rates, eligibility and deadlines; not executed contract terms'});
  const row=(kind:string,amountCents:number):Entry=>({id:`${kind}-${token()}-${i}`,claimId:id,amountCents,recordedAt:posted,settledAt:posted});
  if(!excluded){input.submissions.push(row('line',rate*units));if(!withinTerms){input.receipts.push(row('cash',rate*units));input.credits.push(row('credit',rate*units));}}
  if(sub&&!excluded)input.guaranteeCredits.push(row('offset',40000*units));
 }
 const answer:AnswerKey={version:'challenge-key-v1',seed,salt,originalClaimIds:input.claims.map(c=>c.id),faults:[]};
 // Shuffle eligible records. Negative controls at the end remain untouched.
 const candidates=input.claims.slice(0,claimCount-20).map(c=>c.id);
 for(let i=candidates.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
 const kinds=['omission','underpayment','duplicate','reversal','delivery','eligibility','source',...(sponsor==='wisconsin'?['offset']:[])];
 const start=Math.floor(random()*kinds.length);
 for(let n=0;n<faultCount;n++){
  const id=candidates[n],c=input.claims.find(c=>c.id===id)!,term=input.terms.find(t=>t.drug===c.drug)!;
  const amount=term.manufacturerRateCents*c.units,kind=kinds[(n+start)%kinds.length];
  const snapshot=()=>({claim:input.claims.find(c=>c.id===id),submissions:input.submissions.filter(r=>r.claimId===id),receipts:input.receipts.filter(r=>r.claimId===id),credits:input.credits.filter(r=>r.claimId===id),guaranteeCredits:input.guaranteeCredits.filter(r=>r.claimId===id)});
  const before=structuredClone(snapshot());let expectedKind='',name='',why='',amountCents:number|null=amount;
  if(kind==='omission'){
   input.submissions=input.submissions.filter(r=>r.claimId!==id);input.receipts=input.receipts.filter(r=>r.claimId!==id);input.credits=input.credits.filter(r=>r.claimId!==id);
   expectedKind='Missing submission amount';name='Omitted submission';why='A qualifying claim has no submission, receipt or employer credit after the assumed deadline.';
  }else if(kind==='underpayment'){
   amountCents=1+Math.floor(random()*(amount-1));for(const rows of [input.receipts,input.credits])rows.find(r=>r.claimId===id)!.amountCents-=amountCents;
   expectedKind='Manufacturer underpayment';name='Partial manufacturer payment';why='The settled payment is less than the submitted entitlement. Employer credit matches the amount actually collected.';
  }else if(kind==='duplicate'){
   input.submissions.push({...input.submissions.find(r=>r.claimId===id)!,id:`line-${token()}-extra`});
   expectedKind='Excess submission amount';name='Duplicate submission';why='Two distinct submission lines bill the same entitlement. This is a configuration exposure, not a settled loss.';
  }else if(kind==='reversal'){
   c.reversedAt=`${year}-03-15T00:00:00.000Z`;expectedKind='Credit on a reversed claim';name='Uncorrected reversal';why='A recorded reversal leaves the employer credit outstanding.';
  }else if(kind==='delivery'){
   input.credits=input.credits.filter(r=>r.claimId!==id);expectedKind='Employer credit outstanding';name='Missing employer credit';why='Manufacturer cash was collected, but the employer has not received the corresponding credit.';
  }else if(kind==='eligibility'){
   c.manufacturerEligible=null;expectedKind='Not verified';amountCents=null;name='Missing eligibility';why='Manufacturer eligibility was removed. The detector should refuse to verify the obligation.';
  }else if(kind==='source'){
   input.claims=input.claims.filter(c=>c.id!==id);for(const key of ['submissions','receipts','credits','guaranteeCredits'] as const)input[key]=input[key].filter(r=>r.claimId!==id);
   expectedKind='Source record missing';amountCents=null;name='Entire source record omitted';why='The claim and its financial records were removed from every supplied file. This tests the known source-completeness gap; an internal join cannot establish that an unseen record exists.';
  }else{
   amountCents=500+Math.floor(random()*9501);input.guaranteeCredits.find(r=>r.claimId===id)!.amountCents+=amountCents;
   expectedKind='Guarantee credit mismatch';name='Overstated noncash credit';why='The recorded noncash credit exceeds the supplied WAC-difference calculation.';
  }
  answer.faults.push({id:`fault-${n+1}`,claimId:id,name,expectedKind,amountCents,why,before,after:structuredClone(snapshot())});
 }
 return {input,cutoff,answer,commitment:digest(answer),inputHash:digest(input)};
}
