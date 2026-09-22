import { ChallengePage } from "@/components/leakage-challenge-page";
import { readCheck } from "@/lib/contract-checks/service";
import { selectedSponsor } from "@/lib/contract-checks/context";
import { demoFeaturesEnabled } from "@/lib/config";
import { simulation } from "@/lib/rebate-protection/service";
import { RebateHistory, RebateExceptions } from "@/components/rebate-protection-view";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getClock } from "@/lib/session";
import { getWorkDetail } from "@/lib/queries/agent-work";
import { AGENTS } from "@/lib/agents/registry";
import { nextStep, proposalStatus, workDestination } from "@/lib/agents/work";
import { AgentRefresh } from "@/components/agent-refresh";
import styles from "../../agents.module.css";
export const dynamic = "force-dynamic";
const stamp=(d:Date)=>d.toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZone:"UTC"})+" UTC";
export default async function RunPage({params}:{params:Promise<{runId:string}>}) {
  const clock=await getClock(); const runId=(await params).runId;
  if(runId.startsWith("lch_")){if(!demoFeaturesEnabled())notFound();return <ChallengePage runId={runId}/>;}
  if(runId.startsWith("cck_")) {
    if(!demoFeaturesEnabled())notFound();
    const check=await readCheck(runId,await selectedSponsor());if(!check||check.cutoff>clock.now)notFound();
    return <div className={styles.page}><Link href={`/contract-checks?run=${runId}`}>← Contract checks</Link><header className={styles.heading}><div><p className={styles.eyebrow}>Rebate protection · Scripted sandbox</p><h1>Review contract exceptions</h1><p>Rebate operations · Finance</p></div></header><section className={styles.panel}><h2>Check completed</h2><p>Saved {stamp(check.createdAt)}. Evidence cutoff {check.cutoff.toISOString().slice(0,10)}.</p><ol className="my-5 list-decimal space-y-3 pl-5"><li>Loaded {check.result.claims} synthetic claims and separate transaction files.</li><li>Matched effective terms and independent manufacturer and client eligibility.</li><li>Reconciled submissions, receipts, employer credits and noncash guarantee credits.</li><li>Recorded {check.result.findings.length} findings and observations. No payments or submissions were changed.</li></ol><p>Human review is required for interpretation or financial corrections. No reviewer, decision or application is recorded.</p><Link href={`/contract-checks?run=${runId}`}>Open work queue →</Link></section></div>;
  }
  if(runId.startsWith("rbp_")) {
    if(!demoFeaturesEnabled())notFound();
    const sandbox=await simulation(runId,clock.now);if(!sandbox)notFound();
    return <div className="space-y-6"><Link href={`/rebate-protection?run=${runId}`}>← Rebate protection</Link><header><h1 className="text-3xl font-semibold">Work detail</h1><p className="mt-3 text-sm text-ink-500">Rebate protection · Synthetic simulation · Rebate operations · Finance</p><p className="mt-2">{sandbox.snapshot.scenario.title}</p></header><RebateExceptions run={sandbox}/><RebateHistory run={sandbox}/></div>;
  }
  const data=await getWorkDetail(runId,clock);if(!data)notFound();
  const {run,def,related}=data;const destination=workDestination(run.agentId,run.subjectType,run.subjectId);
  const statuses=run.proposals.map(p=>proposalStatus(p,clock.now));
  const events: {key:string;at:Date;title:string;text:string;note?:string}[]=[];
  for(const p of run.proposals){
    events.push({key:`proposal-${p.id}`,at:p.createdAt,title:"Proposal recorded",text:p.headline,note:p.rationale});
    if(p.reviewedAt&&p.reviewedAt<=clock.now)events.push({key:`review-${p.id}`,at:p.reviewedAt,title:"Employee review recorded",text:p.reviewedBy||"Reviewer not recorded",note: p.overrideNote??"Decision details are limited to the recorded proposal status."});
    if(p.appliedAt&&p.appliedAt<=clock.now)events.push({key:`applied-${p.id}`,at:p.appliedAt,title:"Application recorded",text:p.headline,note:p.autoApplied?"Recorded as automatically applied under the run's policy.":"Application actor is not recorded in this ledger."});
  }
  events.sort((a,b)=>a.at.getTime()-b.at.getTime());
  return <div className={styles.page}>
    <Link className={styles.link} href="/agents?tab=work">← Work</Link>
    <header className={styles.heading}><div><p className={styles.eyebrow}>{def?.name??run.agentId}</p><h1>Work detail</h1><p className={styles.muted}>{stamp(run.startedAt)}</p></div><AgentRefresh/></header>
    <section className={styles.panel}><div className={styles.detailHeader}><div><span className={styles.label}>Task</span><h2>{run.goal}</h2><p>{run.summary}</p><div className="mt-4 flex flex-wrap gap-2"><span className={styles.pill}>Run: {run.outcome}</span>{[...new Set(statuses)].map(s=><span key={s} className={`${styles.pill} ${s.startsWith("Awaiting")?styles.warm:""}`}>{s}</span>)}</div>{run.proposals.length===0&&<p>No proposals recorded. Employee follow-through is not recorded here.</p>}</div><aside><span className={styles.label}>Responsible team</span><p>{def?.owner??"Owner not recorded"}</p><p className={styles.note}>Responsible role, not an employee assignment.</p><Link className={styles.link} href={destination.href}>{destination.label} →</Link><p className={styles.note}>{run.subjectType??"Subject not recorded"}</p></aside></div></section>
    {run.proposals.map(p=>{const status=proposalStatus(p,clock.now);const reviewVisible=p.reviewedAt&&p.reviewedAt<=clock.now;const target=workDestination(p.agentId,p.subjectType,p.subjectId);return <section id={`proposal-${p.id}`} key={p.id} className={styles.panel}><div className={styles.detailHeader}><div><span className={styles.label}>Proposal · {status}</span><h2>{p.headline}</h2><p>{p.rationale}</p><span className={styles.label}>Next step</span><p>{nextStep(status)}</p>{status==="Awaiting review"&&<p>{p.consequential?"The runtime requires human review because this action affects money or care.":"This proposal was recorded for a person to decide."}</p>}{status==="Status unavailable"&&<p>The ledger has no complete status history. A past state cannot be reliably reconstructed.</p>}</div><aside><span className={styles.label}>Employee review</span><p>{reviewVisible?(p.reviewedBy||"Reviewer not recorded"):"No review recorded by this cutoff."}</p>{reviewVisible&&p.overrideNote&&<p>{p.overrideNote}</p>}<Link className={styles.link} href={target.href}>{target.label} →</Link></aside></div><details className={styles.details}><summary>Proposal data</summary><pre className={styles.payload}>{JSON.stringify({action:p.action,confidenceBps:p.confidenceBps,consequential:p.consequential,payload:p.payload},null,2)}</pre></details></section>})}
    <section className={styles.panel}><h2>Work history</h2><ol className={styles.timeline}><li className={styles.event}><h3>Request recorded</h3><time>{stamp(run.startedAt)}</time><p>{run.goal}</p></li><li className={styles.event}><h3>Agent actions & evidence</h3><p>Recorded step order. Individual step timestamps are not available.</p><ol>{run.steps.map(s=><li key={s.id}><strong>{s.kind === "Gate"?"Review gate":s.kind === "Tool"?"Action":s.kind === "Think"?"Recorded rationale":s.kind}</strong> · {s.summary}</li>)}</ol></li><li className={styles.event}><h3>Run {run.outcome.toLowerCase()}</h3><time>{stamp(run.endedAt)}</time><p>{run.summary}</p><p>{nextStep(run.outcome)}</p></li>{events.map(e=><li className={styles.event} key={e.key}><h3>{e.title}</h3><time>{stamp(e.at)}</time><p>{e.text}</p>{e.note&&<p>{e.note}</p>}</li>)}</ol></section>
    <details className={`${styles.panel} ${styles.details}`}><summary>Execution, permissions & technical trace</summary><p className="mt-4">{run.brain === "model"?"Model-driven":run.brain === "deterministic"?"Scripted":run.brain} · {run.autonomy} at execution · {run.elapsedMs} ms · Model spend ${(run.costMillicents/100000).toFixed(4)}</p><p className="mt-2">{run.modelName??"Model name not recorded"} · {run.inputTokens+run.outputTokens} tokens</p><p className="mt-2">Registry tools: {def?.tools.join(", ")??"Not recorded"}. The run records its autonomy; the registry describes current permissions.</p><ul className="my-3 list-disc pl-5">{def?.mayNot.map(m=><li key={m}>{m}</li>)}</ul>{run.steps.map(s=><details key={s.id} className="border-t border-ink-100 py-3"><summary>{s.ordinal}. {s.tool??s.kind} · {s.brain}</summary><p className="mt-2">{s.because}</p><pre className={styles.payload}>{s.detail}</pre></details>)}</details>
    <section className={styles.panel}><h2>Related runs</h2><p className="px-6 py-3 text-xs text-ink-500">Same recorded subject. This does not establish a handoff between agents.</p>{related.length?related.map(r=><div className={styles.related} key={r.id}><Link href={`/agents/runs/${r.id}`}>{AGENTS.find(a=>a.id===r.agentId)?.name??r.agentId} · {r.summary}</Link><p className={styles.note}>{stamp(r.endedAt)}</p></div>):<p className={styles.empty}>{run.subjectId&&run.subjectType?"No other runs recorded for this subject.":"No subject reference available to match related runs."}</p>}</section>
    <p className={styles.note}>Data cutoff {stamp(clock.now)} · Updated {stamp(new Date())}. Recorded activity only.</p>
  </div>;
}
