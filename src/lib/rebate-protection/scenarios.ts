import { type Scenario, type Snapshot, type Cadence, type Event, day, obligation, period, DAYS } from "./model";
export const SCENARIOS: Scenario[] = [
  { id:"omitted", title:"Missing submission", description:"Four eligible claims are absent from the draft submission.", cause:"Submission omission", control:"Reconcile paid claims to submission lines; regenerate the draft before its deadline.", failedClaims:4, expectedManufacturerCents:100000, guaranteeCents:100000, plannedGuaranteeExpenseCents:0, extraCreditCents:0, review:null, beneficiary:"PBM" },
  { id:"eligibility", title:"Eligibility mismatch", description:"Two claims earn no manufacturer rebate but still count toward the client guarantee.", cause:"Contract interpretation", control:"Evaluate manufacturer and client terms independently; send the uncovered obligation to Finance.", failedClaims:0, expectedManufacturerCents:80000, guaranteeCents:100000, plannedGuaranteeExpenseCents:0, extraCreditCents:0, review:"Contract interpretation", beneficiary:"Neither" },
  { id:"benefit", title:"Benefit change", description:"A proposed tier change would forfeit rebates on four claims.", cause:"Contract condition lost", control:"Preflight the change and recommend retaining current benefits. Two proposed member changes are paused for review.", failedClaims:4, expectedManufacturerCents:100000, guaranteeCents:100000, plannedGuaranteeExpenseCents:0, extraCreditCents:0, review:"Benefit activation", beneficiary:"PBM" },
  { id:"duplicate", title:"Reversal & duplicate", description:"A reversed claim is duplicated into a draft employer credit.", cause:"Excess payment", control:"Match the reversal and flag the duplicate. Finance reviews the corrected draft before simulated payment.", failedClaims:0, expectedManufacturerCents:100000, guaranteeCents:100000, plannedGuaranteeExpenseCents:0, extraCreditCents:10000, review:"Payment correction", beneficiary:"PBM" },
  { id:"underpayment", title:"Manufacturer underpayment", description:"An initial 70% receipt leaves a recoverable balance.", cause:"Collection dispute", control:"Match invoice lines to receipts and prepare evidence for the remaining 30%.", failedClaims:3, expectedManufacturerCents:100000, guaranteeCents:100000, plannedGuaranteeExpenseCents:0, extraCreditCents:0, review:null, beneficiary:"PBM" },
  { id:"timing", title:"Within payment terms", description:"Collection is due after 120 days. Until then, the balance is a receivable.", cause:"Timing", control:"Monitor the contractual due date; do not classify normal float as leakage.", failedClaims:0, expectedManufacturerCents:100000, guaranteeCents:100000, plannedGuaranteeExpenseCents:0, extraCreditCents:0, review:null, beneficiary:"Neither" },
  { id:"unfavorable", title:"Contractual shortfall", description:"The approved guarantee exceeds available rebates by $400.", cause:"Contract economics", control:"Report the expected PBM expense. Software cannot eliminate a valid employer entitlement.", failedClaims:0, expectedManufacturerCents:60000, guaranteeCents:100000, plannedGuaranteeExpenseCents:40000, extraCreditCents:0, review:"Contract interpretation", beneficiary:"Neither" },
];
export function fixture(id: string, anchor: string, cadence: Cadence): Snapshot {
  const scenario = SCENARIOS.find(s=>s.id===id); if(!scenario) throw Error("Unknown scenario");
  const claims = Array.from({length: id === "duplicate" ? 11 : 10},(_,i)=>({id:`synthetic-claim-${i+1}`,drug:id==="eligibility" && i>=8 ? "Excluded brand" : "Demo brand",channel:"Retail",tier:2,pa:true,serviceAt:day(anchor,i<5?1:31),reversed:i===10}));
  const base = {version:1,effectiveFrom:anchor,effectiveTo:day(anchor,365),channel:"*",submissionDays:80,cadence,offsets:"None" as const,citation:"Synthetic rebate exhibit v1 · not actual contract terms"};
  const terms: Snapshot["terms"] = [
    {...base,id:"manufacturer-v1",side:"Manufacturer",drug:"Demo brand",tier:2,pa:true,excluded:false,cents:id==="unfavorable"?6000:10000},
    {...base,id:"manufacturer-exclusion-v1",side:"Manufacturer",drug:"Excluded brand",excluded:true,cents:0},
    {...base,id:"client-v1",side:"Client",drug:"*",excluded:false,cents:10000},
  ];
  return {version:1,scenario,anchor,cadence,claims,terms,forecast:{manufacturerCents:100000-(id==="unfavorable"?40000:0),guaranteeExpenseCents:scenario.plannedGuaranteeExpenseCents,frozenAt:anchor},assumptions:[
    "Identical synthetic claims, contracts and external events in both paths. Only the documented control intervention differs.",
    "100% of manufacturer rebates passed through; $20 administration fee disclosed separately and unchanged between paths.",
    "No offsets between reconciliation periods. Manufacturer payment due on day 120; submission deadline day 80.",
    "Baseline omissions miss the deadline; baseline underpayment remains unrecovered at close. These are seeded failures, not measured incumbent performance.",
    "No utilization savings or member cost shifts are counted. No real payment, care change or external communication occurs.",
  ]};
}

/** Generate auditable sandbox events, not operational AgentRun/Proposal records. */
export function eventsForStage(runId: string, s: Snapshot, stage: number, decision: string | null): Event[] {
  const out: Event[] = []; const at=day(s.anchor,DAYS[stage]);
  const emit=(path:Event["path"],kind:string,amount:number,detail:string,claimId:string|null=null,termId:string|null=null,serviceAt=s.anchor,evidenceId:string|null=null)=>{
    const id=`${runId}:${stage}:${out.length}`;
    out.push({id,path,kind,amountCents:amount,detail,claimId,termId,serviceAt,recordedAt:at,settledAt:["Receipt","Employer credit","Guarantee payment"].includes(kind)?at:null,evidenceId:evidenceId??(s.scenario.id==="timing"?null:`${runId}:exception`)});
  };
  const sc=s.scenario;
  const effective= !sc.review || decision === "Approved";
  if(stage===0) {
    emit("Agent","Request",0,`Compare ${sc.title} against the frozen forecast. Scripted execution.`);
    for(const c of s.claims) for(const side of ["Manufacturer","Client"] as const) {
      const o=obligation(c,s.terms,side);
      for(const path of ["Baseline","Glass"] as const) emit(path,side==="Manufacturer"?"Entitlement":"Client obligation",o?.cents??0,o?`${o.eligible?"Eligible":"Excluded"}; ${o.term.citation}`:"Not verified: missing or conflicting terms",c.id,o?.term.id??null,c.serviceAt);
    }
    if(sc.id === "underpayment") for(const path of ["Baseline","Glass"] as const) for(const c of s.claims) {
      const o=obligation(c,s.terms,"Manufacturer");if(!o?.eligible)continue;
      emit(path,"Original submission",o.cents,"Original simulated invoice line.",c.id,o.term.id,c.serviceAt);
      const original=out[out.length-1];original.id=`${runId}:${path}:original:${c.id}`;original.recordedAt=day(s.anchor,45);
      emit(path,"Receipt",Math.round(o.cents*0.7),"Initial partial receipt: 70%. Remaining balance disputed; final payment not yet due.",c.id,o.term.id,c.serviceAt,original.id);
    }
    if(sc.id === "duplicate") for(const path of ["Baseline","Glass"] as const) emit(path,"Reversal evidence",-10000,"Original claim reversed; excludes this claim from both obligations. Baseline duplicate credit remains in the draft.","synthetic-claim-11","client-v1",s.claims[10].serviceAt);
    emit("Agent","Evidence",0,sc.cause==="Timing"?"No exception: receivable is within terms.":`${sc.cause}. ${sc.description}`);
  }
  if(stage===1) {
    emit("Agent",sc.review?"Proposal":"Action",0,sc.control);
    for(const path of ["Baseline","Glass"] as const) for(const [i,c] of s.claims.entries()) {
      const o=obligation(c,s.terms,"Manufacturer"); if(!o?.eligible)continue;
      if(path==="Baseline" && sc.id==="omitted" && i<sc.failedClaims)continue;
      emit(path,"Submission",o.cents,`Simulated submission line ${c.id}; due day ${o.term.submissionDays}. No external transmission.`,c.id,o.term.id,c.serviceAt);
    }
  }
  if(stage===2) {
    emit("Agent","Evidence",0,"Simulated manufacturer response received. Acceptance is not collection; no savings recognized.");
    for(const path of ["Baseline","Glass"] as const) for(const [i,c] of s.claims.entries()) {
      const o=obligation(c,s.terms,"Manufacturer"); if(!o?.eligible)continue;
      const failed = (path==="Baseline"||!effective) && i<sc.failedClaims;
      const omitted = path==="Baseline" && sc.id==="omitted" && failed;
      const submissionId=`${runId}:${path}:submission:${c.id}`;
      emit(path,omitted?"Not submitted":failed && sc.id!=="underpayment"?"Denied":"Accepted",o.cents,omitted?"No submission line exists; deadline missed.":failed?"Seeded baseline failure remains unresolved.":"Simulated response accepted the claim line.",c.id,o.term.id,c.serviceAt,omitted?`${runId}:exception`:submissionId);

    }
  }
  if(stage===3) {
    for(const path of ["Baseline","Glass"] as const) {
      const receiptsByPeriod:Record<string,number>={}; const guaranteesByPeriod:Record<string,number>={};
      for(const [i,c] of s.claims.entries()) {
        const m=obligation(c,s.terms,"Manufacturer"),g=obligation(c,s.terms,"Client");
        if(!m||!g)continue;
        const p=period(c.serviceAt,s.cadence);
        guaranteesByPeriod[p]=(guaranteesByPeriod[p]??0)+g.cents;
        let paid=m.cents; const failed=(path==="Baseline"||!effective);
        if(sc.id==="underpayment" && failed) paid=Math.round(m.cents*0.7);
        else if(failed && i<sc.failedClaims)paid=sc.id==="benefit"?(obligation({...c,tier:3},s.terms,"Manufacturer")?.cents??0):0;
        const ref=`${runId}:${path}:response:${c.id}`;
        const initial=sc.id==="underpayment"?Math.round(m.cents*0.7):0;
        if(paid-initial>0)emit(path,"Receipt",paid-initial,"Simulated cash settled and allocated to this claim.",c.id,m.term.id,c.serviceAt,ref);
        receiptsByPeriod[p]=(receiptsByPeriod[p]??0)+paid;
        if(m.cents>paid)emit(path,sc.id==="benefit"?"Forfeited":"Collection loss",m.cents-paid,"Unrecovered at final reconciliation; seeded loss confirmed.",c.id,m.term.id,c.serviceAt,ref);
      }
      for(const [p,guaranteed] of Object.entries(guaranteesByPeriod)) {
        const collected=receiptsByPeriod[p]??0,topup=Math.max(0,guaranteed-collected);
        const serviceAt=s.claims.find(c=>period(c.serviceAt,s.cadence)===p)!.serviceAt;
        if(topup)emit(path,"Guarantee payment",topup,`PBM-funded guarantee for ${p}; no cross-period offsets.`,null,"client-v1",serviceAt);
        emit(path,"Employer credit",Math.max(guaranteed,collected),`Full contractual entitlement credited for ${p}.`,null,"client-v1",serviceAt);
      }
      if(sc.extraCreditCents && (path==="Baseline"||!effective)) {
        emit(path,"Employer credit",sc.extraCreditCents,"Incorrect duplicate credit on reversed claim.","synthetic-claim-11","client-v1");
        emit(path,"Excess payment",sc.extraCreditCents,"Excess above entitlement; not a reduction in legitimate employer payment.","synthetic-claim-11","client-v1");
      }
      emit(path,"Reconciliation closed",0,"Simulated settlement completed. All amounts trace to fixture terms and ledger events.");
    }
    emit("Agent","Outcome",0,effective?"Control completed where applicable; valid contractual shortfalls remain payable.":"Recommendation rejected in simulated review. Baseline failure remains; no benefit attributed.");
  }
  // Stable evidence references to actual records, not labels that cannot be opened.
  for(const e of out) {
    if(e.kind==="Submission")e.id=`${runId}:${e.path}:submission:${e.claimId}`;
    if(["Accepted","Denied","Not submitted"].includes(e.kind))e.id=`${runId}:${e.path}:response:${e.claimId}`;
  }
  return out;
}
