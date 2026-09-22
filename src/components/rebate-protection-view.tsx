import Link from "next/link";
import type { Simulation } from "@/lib/rebate-protection/service";
import { DAYS, day, OWNER, STAGES } from "@/lib/rebate-protection/model";
import styles from "./rebate-protection.module.css";
export const dollars=(n:number|null)=>n===null?"Not verified":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(n/100);
const date=(s:string)=>new Date(s).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
export function RebateMetrics({run}:{run:Simulation}){
 const r=run.result;return <div className={styles.metrics}>
  <article><span>Baseline operational loss</span><strong>{dollars(r.baseline.operationalLossCents)}</strong><small>{r.baseline.settled?"Confirmed in simulation":"No unsettled loss counted"}</small></article>
  <article><span>Glass residual loss</span><strong>{dollars(r.glass.operationalLossCents)}</strong><small>{r.glass.settled?"After recorded controls":"Settlement pending"}</small></article>
  <article className={styles.highlight}><span>Attributed benefit</span><strong>{dollars(r.recognizedBenefitCents)}</strong><small>{r.proven?"Settled simulation evidence":"No credit for detection alone"}</small></article>
  <article><span>Glass guarantee expense</span><strong>{dollars(r.glass.topupCents)}</strong><small>{dollars(r.glass.expectedGuaranteeCents)} expected in frozen forecast</small></article>
 </div>;
}
export function RebateDelivery({run}:{run:Simulation}){
 const g=run.result.glass;return <section className={styles.panel}>
  <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Synthetic demonstration</span><h2>Rebate delivery</h2></div><Link href={`/rebate-protection?run=${run.id}`}>Open evidence →</Link></div>
  <p className={styles.muted}>{run.snapshot.scenario.title} · {date(run.cutoff)} · {run.snapshot.cadence}. These figures do not verify actual employer payments.</p>
  <div className={styles.delivery}>
   {[['Employer entitlement',g.entitlementCents],['Manufacturer receipts',g.receiptsCents],['PBM-funded top-up',g.topupCents],['Employer credits',g.employerCreditsCents],['Not yet credited',g.unresolvedCents]].map(([label,value])=><div key={String(label)}><span>{label}</span><strong>{dollars(value as number|null)}</strong></div>)}
  </div>
  <p className={styles.note}>100% rebate pass-through. $20 administration fee, separate from rebates and unchanged between paths. Employer entitlement is never reduced to generate savings.</p>
 </section>;
}
export function RebatePosition({run}:{run:Simulation}){
 const r=run.result,s=run.snapshot;
 return <><RebateDelivery run={run}/><section className={styles.panel}><h2>Open position</h2>
  <div className={styles.delivery}>{[['Collection exposure',r.glass.collectionExposureCents],['Overdue receivable',r.glass.overdueCents],['Unexpected guarantee expense',r.glass.unexpectedGuaranteeCents]].map(([label,value])=><div key={String(label)}><span>{label}</span><strong>{dollars(value as number|null)}</strong></div>)}</div>
  {!r.glass.settled&&<p className={styles.note}>Open-period sensitivity: {dollars(Math.round(s.forecast.manufacturerCents*.9))}–{dollars(Math.round(s.forecast.manufacturerCents*1.1))} manufacturer receipts. Assumption: ±10% of the frozen forecast, not a confidence interval. Guarantee expense is not final.</p>}
  <p className={styles.note}>Payment due {date(day(s.anchor,120))}. Normal float stays a receivable. Contract shortfalls remain payable even when every operational control succeeds.</p>
 </section></>;
}
export function RebateExceptions({run}:{run:Simulation}){
 const s=run.snapshot,done=run.result.proven;
 return <section className={styles.panel}><h2>Exception work</h2>{run.exceptions.length?run.exceptions.map(e=><article id={e.id} key={e.id} className={styles.exception}>
  <div><span className={styles.eyebrow}>{e.owner}</span><h3>{e.reason}</h3><p>{s.scenario.description}</p><p className={styles.note}>Review by {date(e.dueAt)} · Responsible role, not an employee assignment.</p></div>
  <div><strong>{dollars(e.amountCents)}</strong><span className={styles.badge}>{done?(run.result.glass.operationalLossCents?"Residual loss":s.scenario.review==="Contract interpretation"?"Contract cost remains":"Control completed"):run.decision?`Simulated review: ${run.decision}`:run.stage===1&&s.scenario.review?"Awaiting simulated review":"Open exposure"}</span></div>
  <div className={styles.full}><p>{s.scenario.control}</p><Link href={`/agents/runs/${run.id}`}>Agent work & evidence →</Link><details><summary>Terms, claims and frozen forecast</summary><pre>{JSON.stringify(JSON.parse(e.evidence),null,2)}</pre></details></div>
 </article>):<p className={styles.muted}>{run.stage<0?"No events recorded by this cutoff.":"No leakage exception. Collection is within contractual terms."}</p>}</section>;
}
export function RebateProof({run}:{run:Simulation}){
 const r=run.result,s=run.snapshot;
 const rows:[string,number|null,number|null][]=[
  ["Manufacturer entitlement",r.baseline.earnedCents,r.glass.earnedCents],
  ["Manufacturer receipts",r.baseline.receiptsCents,r.glass.receiptsCents],
  ["Employer entitlement",r.baseline.entitlementCents,r.glass.entitlementCents],
  ["Employer credits",r.baseline.employerCreditsCents,r.glass.employerCreditsCents],
  ["Expected guarantee expense",r.baseline.expectedGuaranteeCents,r.glass.expectedGuaranteeCents],
  ["Actual guarantee expense",r.baseline.topupCents,r.glass.topupCents],
  ["Unexpected guarantee expense",r.baseline.unexpectedGuaranteeCents,r.glass.unexpectedGuaranteeCents],
  ["Operational losses",r.baseline.operationalLossCents,r.glass.operationalLossCents],
 ];
 return <><section className={styles.panel}><h2>Same book. Recorded interventions.</h2><p className={styles.muted}>Ten paid synthetic claims{ s.scenario.id==="duplicate"?" and one reversal":""}. Frozen forecast {date(s.forecast.frozenAt)}. Neither path changes employer guarantees.</p>
 <div className={styles.tableWrap}><table><thead><tr><th>Measure</th><th>Baseline</th><th>Glass</th></tr></thead><tbody>{rows.map(([label,b,g])=><tr key={label}><td>{label}</td><td>{dollars(b)}</td><td>{dollars(g)}</td></tr>)}</tbody></table></div>
 <div className={styles.delivery}>{[['Additional receipts',r.incrementalReceiptsCents],['Guarantee expense reduction',r.guaranteeReductionCents],['PBM benefit',r.pbmBenefitCents],['Employer benefit',r.employerBenefitCents]].map(([label,value])=><div key={String(label)}><span>{label}</span><strong>{dollars(value as number)}</strong></div>)}</div>
 <p className={styles.note}>Additional receipts and the resulting guarantee reduction are overlapping effects, not additive savings. Attributed benefit counts incremental cash plus prevented excess payments once.</p>
 <p className={styles.note}>Member impact: {s.scenario.id==="benefit"?`two members in the proposed tier change; ${run.decision==="Approved"?"current benefits retained in Glass":"no Glass prevention credited before approval"}. No member cost shifts counted.`:"no benefit or access changes in either path."}</p>
 </section><section className={styles.panel}><h2>Assumptions & variance</h2><p>Root cause: {s.scenario.cause}. Utilization is fixed in both paths.</p><ul className={styles.list}>{s.assumptions.map(a=><li key={a}>{a}</li>)}</ul><p className={styles.note}>A fixed expected-results test fixture independently checks the engine. These scenarios demonstrate control behavior, not actual Caremark savings or an independently audited result.</p><details><summary>Frozen contract versions & claims</summary><pre>{JSON.stringify(s,null,2)}</pre></details></section><RebateExceptions run={run}/><RebateHistory run={run}/></>;
}
export function RebateHistory({run}:{run:Simulation}){
 return <section className={styles.panel}><h2>Action history</h2><p className={styles.muted}>{OWNER} · Scripted execution · {run.stage<0?"No recorded activity":STAGES[run.stage]}. Sandbox records are excluded from operational agent counts.</p>
 <ol className={styles.timeline}>{run.events.filter(e=>e.path==="Agent").map(e=><li key={e.id} id={e.id}><span>{date(e.recordedAt)} · {e.kind}</span><p>{e.detail}</p></li>)}</ol>
 <details><summary>Claim-to-cash ledger · {run.events.filter(e=>e.path!=="Agent").length} events</summary><div className={styles.tableWrap}><table><thead><tr><th>Path / event</th><th>Claim / term</th><th>Amount</th><th>Recorded / settled</th><th>Evidence</th></tr></thead><tbody>{run.events.filter(e=>e.path!=="Agent").map(e=><tr key={e.id} id={e.id}><td>{e.path}<small>{e.kind}</small></td><td>{e.claimId??"Period total"}<small>{e.termId??"—"}</small><small>Service {date(e.serviceAt)}</small></td><td>{dollars(e.amountCents)}</td><td>{date(e.recordedAt)}<small>{e.settledAt?date(e.settledAt):"Not settled"}</small></td><td>{e.detail}<small>{e.evidenceId&&<a href={`#${e.evidenceId}`}>Source record</a>}</small></td></tr>)}</tbody></table></div></details>
 </section>;
}
export function RebateCheckpoints({run,tab}:{run:Simulation;tab:string}){
 return <div className={styles.checkpoints}><span>View checkpoint</span>{DAYS.map((n,i)=>i<=run.currentStage?<Link aria-current={run.stage===i?"step":undefined} key={n} href={`/rebate-protection?run=${run.id}&tab=${tab}&cutoff=${encodeURIComponent(day(run.snapshot.anchor,n))}`}>{STAGES[i]}</Link>:<span key={n}>{STAGES[i]}</span>)}<Link href={`/rebate-protection?run=${run.id}&tab=${tab}`}>Latest</Link></div>;
}
