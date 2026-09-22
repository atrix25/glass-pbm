import { evidenceAt, type Detection, type Evidence, type Finding } from './detector';
export const TESTS = [
 {id:'integrity',name:'Record integrity',rule:'Every transaction must match a recorded claim. Claim IDs and record IDs must be unique.',kinds:['Duplicate record ID','Duplicate claim ID','Unmatched transaction']},
 {id:'eligibility',name:'Contract and eligibility',rule:'Each active claim needs one effective term and separate manufacturer and client eligibility.',kinds:['Not verified']},
 {id:'submission',name:'Submission completeness',rule:'By the submission deadline, invoiced amounts must cover the manufacturer entitlement.',kinds:['Missing submission amount']},
 {id:'accuracy',name:'Submission accuracy',rule:'Submitted amounts must not exceed the calculated manufacturer entitlement.',kinds:['Excess submission amount']},
 {id:'collections',name:'Manufacturer collections',rule:'At the collection deadline, settled receipts must cover the eligible invoiced amount.',kinds:['Manufacturer underpayment']},
 {id:'reversals',name:'Reversed claims',rule:'Reversed claims must not retain positive employer credits or uncorrected submissions.',kinds:['Credit on a reversed claim','Submission on a reversed claim']},
 {id:'delivery',name:'Employer rebate delivery',rule:'By the credit deadline, collected manufacturer rebates must be credited to the employer.',kinds:['Employer credit outstanding']},
 {id:'offsets',name:'Noncash guarantee credits',rule:'Recorded guarantee credits must equal the permitted WAC difference times units. They are not cash rebates.',kinds:['Guarantee credit mismatch']},
] as const;
export const COVERAGE_GAPS = [
 {id:'source-completeness',name:'Source-file completeness',rule:'Independent control totals are needed to prove that all claims and financial records were supplied.'},
 {id:'manufacturer-terms',name:'Actual manufacturer entitlement',rule:'Executed manufacturer exhibits, eligibility conditions and drug-level rates are not loaded.'},
 {id:'benefit-changes',name:'Benefit-change impact',rule:'No actual formulary or benefit-change feed is connected to these checks.'},
 {id:'settlement',name:'Final guarantee settlement',rule:'Executed client terms and complete top-up/payment allocations are needed to verify final settlement.'},
];
export function testInventory(input:Evidence,result:Detection){
 const e=evidenceAt(input,result.cutoff);
 e.receipts=e.receipts.filter(r=>!!r.settledAt);e.credits=e.credits.filter(r=>!!r.settledAt);
 const active=e.claims.filter(c=>!c.reversedAt),reversed=e.claims.filter(c=>!!c.reversedAt);
 const valid=active.filter(c=>c.manufacturerEligible!==null&&c.clientEligible!==null&&e.terms.filter(t=>t.drug===c.drug&&t.from<=c.serviceAt&&t.to>=c.serviceAt).length===1);
 const integrityBroken=result.findings.some(f=>TESTS[0].kinds.some(k=>k===f.kind));
 const unknown=active.length-valid.length;
 return TESTS.map(t=>{
  const findings=result.findings.filter(f=>t.kinds.some(k=>k===f.kind));
  let evaluated=0,pending=0,blocked=0;
  if(t.id==='integrity')evaluated=e.claims.length+e.submissions.length+e.receipts.length+e.credits.length+e.guaranteeCredits.length;
  else if(t.id==='eligibility')evaluated=active.length;
  else if(t.id==='reversals')evaluated=reversed.length;
  else {
   blocked=integrityBroken?active.length:unknown;
   if(!integrityBroken)for(const c of valid){
    const term=e.terms.find(t=>t.drug===c.drug&&t.from<=c.serviceAt&&t.to>=c.serviceAt)!;
    let applicable=true,due=true;
    if(t.id==='submission'){applicable=c.manufacturerEligible===true;due=result.cutoff>=term.invoiceDue;}
    if(t.id==='collections'){applicable=c.manufacturerEligible===true&&e.submissions.some(r=>r.claimId===c.id);due=result.cutoff>=term.receiptDue;}
    if(t.id==='delivery'){applicable=e.receipts.some(r=>r.claimId===c.id);due=result.cutoff>=term.creditDue;}
    if(t.id==='offsets')applicable=!!term.substitution||e.guaranteeCredits.some(r=>r.claimId===c.id);
    if(applicable){if(due)evaluated++;else pending++;}
   }
  }
  const status=findings.length?'Exceptions':blocked?'Incomplete':evaluated?'Clear':pending?'Not due':'No applicable records';
  return {...t,findings,evaluated,pending,blocked,status,amountCents:findings.some(f=>f.amountCents===null)?null:findings.reduce((s,f)=>s+(f.amountCents??0),0)};
 });
}
export type TestResult=ReturnType<typeof testInventory>[number];
export function findingEvidence(input:Evidence,cutoff:string,f:Finding){
 const e=evidenceAt(input,cutoff),claim=e.claims.find(c=>c.id===f.claimId),term=e.terms.find(t=>t.id===f.termId);
 const sum=(rows:Evidence['receipts'])=>rows.filter(r=>r.claimId===f.claimId).reduce((s,r)=>s+r.amountCents,0);
 const invoice=sum(e.submissions),cash=sum(e.receipts.filter(r=>!!r.settledAt)),credit=sum(e.credits.filter(r=>!!r.settledAt));
 const entitlement=claim&&term&&claim.manufacturerEligible!==null?(claim.manufacturerEligible?term.manufacturerRateCents*claim.units:0):null;
 const offset=claim&&term?(term.substitution&&claim.manufacturerEligible?Math.max(0,term.substitution.referenceWacCents-term.substitution.productWacCents)*claim.units:0):null;
 const comparison:Record<string,{expected:number|null;actual:number;label:string;deadline?:string}>={
 'Missing submission amount':{expected:entitlement,actual:invoice,label:'Entitlement vs submitted',deadline:term?.invoiceDue},
 'Excess submission amount':{expected:entitlement,actual:invoice,label:'Permitted vs submitted'},
 'Manufacturer underpayment':{expected:entitlement===null?null:Math.min(entitlement,invoice),actual:cash,label:'Eligible invoice vs receipts',deadline:term?.receiptDue},
 'Employer credit outstanding':{expected:cash,actual:credit,label:'Collected vs credited',deadline:term?.creditDue},
 'Credit on a reversed claim':{expected:0,actual:credit,label:'Permitted credit vs recorded credit'},
 'Submission on a reversed claim':{expected:0,actual:invoice,label:'Permitted submission vs recorded submission'},
 'Guarantee credit mismatch':{expected:offset,actual:sum(e.guaranteeCredits),label:'Calculated vs recorded noncash credit'},
 };
 return {claim,term,comparison:comparison[f.kind],records:{submissions:e.submissions.filter(r=>r.claimId===f.claimId),receipts:e.receipts.filter(r=>r.claimId===f.claimId),credits:e.credits.filter(r=>r.claimId===f.claimId),guaranteeCredits:e.guaranteeCredits.filter(r=>r.claimId===f.claimId)}};
}
