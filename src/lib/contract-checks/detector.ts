/** Pure reconciliation. Does not import fixtures, scenario names, or expected answers. */
export type Claim = { id:string; serviceAt:string; recordedAt:string; reversedAt?:string; drug:string; units:number; manufacturerEligible:boolean|null; clientEligible:boolean|null };
export type Term = { id:string; drug:string; from:string; to:string; recordedAt:string; manufacturerRateCents:number; guaranteeRateCents:number; invoiceDue:string; receiptDue:string; creditDue:string; substitution?:{referenceWacCents:number; productWacCents:number}; citation:string };
export type Entry = { id:string; claimId:string; amountCents:number; recordedAt:string; settledAt?:string };
export type Evidence = { sponsor:string; version:string; claims:Claim[]; terms:Term[]; submissions:Entry[]; receipts:Entry[]; credits:Entry[]; guaranteeCredits:Entry[] };
export type Finding = { id:string; claimId:string; kind:string; amountCents:number|null; category:"collection"|"payment"|"employer"|"terms"|"timing"|"economics"|"configuration"; evidence:string[]; termId:string|null; nextStep:string; owner:string };
const total = (rows:Entry[]) => rows.reduce((sum,row)=>sum+row.amountCents,0);
export function detect(input:Evidence, cutoff:string) {
  if(!Number.isFinite(Date.parse(cutoff)))throw Error("Invalid cutoff");
  cutoff=new Date(cutoff).toISOString();
  const visible=(rows:Entry[],cash=false)=>rows.filter(r=>Date.parse(r.recordedAt)<=Date.parse(cutoff)&&(!cash||!!r.settledAt&&Date.parse(r.settledAt)<=Date.parse(cutoff)));
  const submissions=visible(input.submissions),receipts=visible(input.receipts,true),credits=visible(input.credits,true),guaranteeCredits=visible(input.guaranteeCredits);
  const findings:Finding[]=[];
  let manufacturerCents=0,guaranteeCents=0,cashCents=0,employerCreditsCents=0,substitutionCents=0,verified=0,eligibleClaims=0,unknown=false;
  const claims=input.claims.filter(c=>Date.parse(c.recordedAt)<=Date.parse(cutoff)&&Date.parse(c.serviceAt)<=Date.parse(cutoff));
  const visibleClaimIds=new Set(claims.map(c=>c.id));
  for(const [name,rows] of Object.entries({submissions,receipts,credits,guaranteeCredits})){
    const seen=new Set<string>();
    for(const row of rows){
      if(!visibleClaimIds.has(row.claimId)||seen.has(row.id)){
        unknown=true;
        findings.push({id:`${name}:${row.id}:integrity`,claimId:row.claimId,kind:seen.has(row.id)?"Duplicate record ID":"Unmatched transaction",amountCents:null,category:"terms",evidence:[row.id],termId:null,nextStep:"Resolve the source record before relying on aggregate results.",owner:"Rebate operations · Finance"});
      }
      seen.add(row.id);
    }
  }
  if(new Set(claims.map(c=>c.id)).size!==claims.length){
    unknown=true;findings.push({id:"duplicate-claim",claimId:"Source file",kind:"Duplicate claim ID",amountCents:null,category:"terms",evidence:[],termId:null,nextStep:"Deduplicate the source file before reconciliation.",owner:"Rebate operations · Finance"});
  }
  for(const c of claims){
    const invoices=submissions.filter(r=>r.claimId===c.id),cash=receipts.filter(r=>r.claimId===c.id),paid=credits.filter(r=>r.claimId===c.id),offsets=guaranteeCredits.filter(r=>r.claimId===c.id);
    const terms=input.terms.filter(t=>t.drug===c.drug&&t.from<=c.serviceAt&&t.to>=c.serviceAt&&t.recordedAt<=cutoff);
    const t=terms.length===1?terms[0]:null;
    const add=(kind:string,amountCents:number|null,category:Finding['category'],nextStep:string,rows:Entry[]=[])=>findings.push({id:`${c.id}:${kind}`,claimId:c.id,kind,amountCents,category,evidence:[c.id,...rows.map(r=>r.id)],termId:t?.id??null,nextStep,owner:category==="terms"?"Contract management":"Rebate operations · Finance"});
    if(c.reversedAt&&c.reversedAt<=cutoff){
      if(total(paid)>0)add("Credit on a reversed claim",total(paid),"payment","Review the reversal and correct the sandbox credit. No employer debit is automatic.",paid);
      else if(total(invoices)>0)add("Submission on a reversed claim",total(invoices),"configuration","Regenerate the draft submission and reconcile any manufacturer receipt.",invoices);
      continue;
    }
    cashCents+=total(cash);employerCreditsCents+=total(paid);
    if(!t||c.manufacturerEligible===null||c.clientEligible===null){unknown=true;add("Not verified",null,"terms","Obtain the missing eligibility or a single applicable contract version.");continue;}
    verified++;eligibleClaims+=Number(c.clientEligible);
    const entitlement=c.manufacturerEligible?t.manufacturerRateCents*c.units:0;
    const floor=c.clientEligible?t.guaranteeRateCents:0;
    manufacturerCents+=entitlement;guaranteeCents+=floor;
    const substitution=t.substitution&&c.manufacturerEligible?Math.max(0,t.substitution.referenceWacCents-t.substitution.productWacCents)*c.units:0;
    substitutionCents+=substitution;
    if(substitution!==total(offsets))add("Guarantee credit mismatch",Math.abs(substitution-total(offsets)),"configuration","Verify the NDC, fill-date WAC and units before correcting the noncash guarantee credit.",offsets);
    if(total(invoices)<entitlement&&cutoff>=t.invoiceDue)add("Missing submission amount",entitlement-total(invoices),"collection","Prepare the missing submission amount. Recovery stays zero until settlement.",invoices);
    if(total(invoices)>entitlement)add("Excess submission amount",total(invoices)-entitlement,"configuration","Review duplicates, reversals and eligibility before resubmission.",invoices);
    const short=Math.max(0,Math.min(entitlement,total(invoices))-total(cash));
    if(short>0)add(cutoff>=t.receiptDue?"Manufacturer underpayment":"Within collection terms",short,cutoff>=t.receiptDue?"collection":"timing",cutoff>=t.receiptDue?"Prepare a dispute using the invoice and receipt allocation.":"Monitor the contractual due date; do not classify this balance as leakage.",[...invoices,...cash]);
    if(total(cash)>total(paid)&&cutoff>=t.creditDue)add("Employer credit outstanding",total(cash)-total(paid),"employer","Reconcile and deliver the amount owed to the employer.",[...cash,...paid]);
    if(!c.manufacturerEligible&&floor>0)add("Guarantee without manufacturer entitlement",floor,"economics","Retain the employer guarantee. Review the contract economics; this is not an operational loss.");
  }
  return {cutoff,findings,claims:claims.length,verified,eligibleClaims,complete:!unknown,
    manufacturerCents:unknown?null:manufacturerCents,guaranteeCents:unknown?null:guaranteeCents,cashCents,employerCreditsCents,substitutionCents,
    guaranteeExpenseCents:unknown?null:Math.max(0,guaranteeCents-cashCents-substitutionCents),
    collectionExposureCents:findings.filter(f=>f.category==="collection").reduce((s,f)=>s+(f.amountCents??0),0),
    incorrectCreditCents:findings.filter(f=>f.category==="payment").reduce((s,f)=>s+(f.amountCents??0),0),
    employerOutstandingCents:findings.filter(f=>f.category==="employer").reduce((s,f)=>s+(f.amountCents??0),0),
    realizedSavingsCents:0,
  };
}
export type Detection = ReturnType<typeof detect>;

/** Export only evidence observable at the saved cutoff, including reversal visibility. */
export function evidenceAt(input:Evidence, cutoff:string):Evidence {
 const keep=(r:{recordedAt:string;settledAt?:string})=>r.recordedAt<=cutoff&&(!r.settledAt||r.settledAt<=cutoff);
 return {...input,claims:input.claims.filter(c=>c.recordedAt<=cutoff&&c.serviceAt<=cutoff).map(c=>({...c,reversedAt:c.reversedAt&&c.reversedAt<=cutoff?c.reversedAt:undefined})),terms:input.terms.filter(keep),submissions:input.submissions.filter(keep),receipts:input.receipts.filter(keep),credits:input.credits.filter(keep),guaranteeCredits:input.guaranteeCredits.filter(keep)};
}
