import Link from "next/link";
import { notFound } from "next/navigation";
import { demoFeaturesEnabled } from "@/lib/config";
import { getClock } from "@/lib/session";
import { recentSimulations, simulation } from "@/lib/rebate-protection/service";
import { SCENARIOS } from "@/lib/rebate-protection/scenarios";
import { RebateControls } from "@/components/rebate-protection-controls";
import { RebatePosition, RebateExceptions, RebateProof, RebateCheckpoints, RebateMetrics } from "@/components/rebate-protection-view";
import styles from "@/components/rebate-protection.module.css";
export const dynamic="force-dynamic";
export default async function RebatePage({searchParams}:{searchParams:Promise<{run?:string;tab?:string;cutoff?:string}>}){
 if(!demoFeaturesEnabled())notFound();
 const q=await searchParams,clock=await getClock();
 const recent=await recentSimulations();
 const id=q.run??recent[0]?.id;
 if(q.cutoff&&!Number.isFinite(Date.parse(q.cutoff)))notFound();
 const run=id?await simulation(id,clock.now,q.cutoff):null;if(id&&!run)notFound();
 const tab=["position","exceptions","proof"].includes(q.tab??"")?q.tab!:"position";
 return <div className={styles.page}>
  <header className={styles.header}><div><span className={styles.eyebrow}>Rebate operations</span><h1>Rebate protection</h1><p className={styles.muted}>Prevent the loss. Preserve the promise.</p></div><span className={styles.badge}>Synthetic proof · No real money movement</span></header>
  {run&&<RebateMetrics run={run}/>}
  <RebateControls key={run?.id??"new"} run={run}/>
  {recent.length>0&&<div className={styles.recent} aria-label="Recent simulations">{recent.slice(0,7).map(r=><Link key={r.id} href={`/rebate-protection?run=${r.id}`} aria-current={r.id===run?.id?"page":undefined}>{SCENARIOS.find(s=>s.id===r.scenarioId)?.title} · {r.createdAt.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"UTC"})} UTC</Link>)}</div>}
  {run?<><div className={styles.sectionHeading}><div><h2>{run.snapshot.scenario.title}</h2><p className={styles.muted}>{run.snapshot.scenario.description}</p></div><div className="flex gap-5"><a href={`/api/rebate-protection?id=${run.id}${q.cutoff?`&cutoff=${encodeURIComponent(q.cutoff)}`:""}`} download={`rebate-proof-${run.id}.json`}>Export evidence</a><Link href={`/agents/runs/${run.id}`}>Agent work →</Link></div></div>
   <nav className={styles.tabs} aria-label="Rebate protection views">{["position","exceptions","proof"].map(t=><Link key={t} href={`/rebate-protection?run=${run.id}&tab=${t}${q.cutoff?`&cutoff=${encodeURIComponent(q.cutoff)}`:""}`} aria-current={tab===t?"page":undefined}>{t[0].toUpperCase()+t.slice(1)}</Link>)}</nav>
   <RebateCheckpoints run={run} tab={tab}/>
   {tab==="position"?<RebatePosition run={run}/>:tab==="exceptions"?<RebateExceptions run={run}/>:<RebateProof run={run}/>}
   <p className={styles.note}>Sandbox cutoff {run.cutoff.slice(0,10)} · Created {run.createdAt.slice(0,10)}. Sandbox time is separate from recording time. Historical views exclude subsequent responses, reviews and settlements.</p>
  </>:<section className={`${styles.panel} ${styles.empty}`}><h2>Seven ways to test the controls.</h2><p>Choose a scenario. Follow the same claims through a documented baseline and Glass. Advance through review, manufacturer response and settlement to see which losses were prevented—and which costs remain.</p><p>Every result is synthetic. No actual savings are claimed.</p></section>}
 </div>;
}
