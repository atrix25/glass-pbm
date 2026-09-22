import { LeakageTests } from "./leakage-tests";
import { testInventory, TESTS, COVERAGE_GAPS } from "@/lib/contract-checks/inventory";
import Link from "next/link";
import { notFound } from "next/navigation";
import { selectedSponsor } from "@/lib/contract-checks/context";
import { PROFILES } from "@/lib/contract-checks/profiles";
import { evidenceFor, DEFAULT_CUTOFF } from "@/lib/contract-checks/evidence";
import { detect } from "@/lib/contract-checks/detector";
import { readCheck } from "@/lib/contract-checks/service";
import { getClock } from "@/lib/session";
import { formatCents } from "@/lib/money";
import { ContractCheckControls } from "./contract-check-controls";
import styles from "./rebate-protection.module.css";
export async function ContractCheckPage({runId,tab="tests",testId}:{runId?:string;tab?:string;testId?:string}){
 const sponsor=await selectedSponsor(),profile=PROFILES[sponsor],clock=await getClock();
 const saved=runId?await readCheck(runId,sponsor):null;
 if(runId&&(!saved||saved.cutoff>clock.now))notFound();
 const input=saved?.input??evidenceFor(sponsor),cutoff=saved?.cutoff.toISOString()??new Date(Math.min(Date.parse(DEFAULT_CUTOFF[sponsor]),clock.now.getTime())).toISOString();
 const result=saved?.result??detect(input,cutoff),base=`/contract-checks?${saved?`run=${saved.id}&`:""}`;
 const inventory=testInventory(input,result);
 if(testId&&![...TESTS,...COVERAGE_GAPS].some(t=>t.id===testId))notFound();
 const visibleTab=["tests","findings","evidence","source"].includes(tab)?tab:"tests";
 const active=result.findings.filter(f=>!["timing","economics"].includes(f.category));
 return <div className={styles.page}>
  <header className={styles.header}><div><span className={styles.eyebrow}>{profile.name} · Rebate protection</span><h1>Leakage tests</h1><p className={styles.muted}>{profile.subtitle}</p></div><span className={styles.badge}>Synthetic transactions · Deterministic checks</span></header>
  <div className={styles.metrics}>
   <article><span>Detection tests</span><strong>{inventory.length}</strong><small>Implemented controls</small></article>
   <article><span>With exceptions</span><strong>{inventory.filter(t=>t.findings.length>0).length}</strong><small>Open a test for the cause and evidence</small></article>
   <article><span>Clear</span><strong>{inventory.filter(t=>t.status==="Clear"&&t.blocked===0&&t.pending===0).length}</strong><small>Fully evaluated applicable populations</small></article>
   <article><span>Not connected</span><strong>{COVERAGE_GAPS.length}</strong><small>Additional sources and controls needed</small></article>
  </div>
  {sponsor==="wisconsin"&&<Link href="/rebate-protection?tab=scenarios">Scenario simulations →</Link>}
  <Link className={styles.panel} href="/leakage-challenges"><strong>Blind challenges →</strong><p>Let the challenge agent introduce undisclosed errors, then compare what Glass caught and missed.</p></Link>
  <ContractCheckControls key={saved?.id??sponsor} cutoff={cutoff} maxDate={clock.now.toISOString().slice(0,10)}/>
  <div className={styles.sectionHeading}><p className={styles.muted}>{active.length} items need attention · Cutoff {cutoff.slice(0,10)}{saved?` · Saved ${saved.createdAt.toISOString().slice(0,19).replace("T"," ")} UTC`:" · Calculated on load"}</p>{saved&&<div className="flex gap-5"><Link href={`/agents/runs/${saved.id}`}>Agent work →</Link><a href={`/api/contract-checks?id=${saved.id}`}>Export run →</a></div>}</div>
  <nav className={styles.tabs} aria-label="Contract checks">{[["tests","Tests"],["findings","All findings"],["evidence","Evidence"],["source","Source & scope"]].map(([id,name])=><Link key={id} href={`${base}tab=${id}`} aria-current={visibleTab===id?"page":undefined}>{name}</Link>)}</nav>
  {visibleTab==="tests"?<LeakageTests input={input} result={result} base={base} testId={testId}/>:visibleTab==="findings"?<>
   <section className={styles.panel}><div className={styles.sectionHeading}><h2>Review queue</h2><span className={styles.badge}>Rebate protection agent · Scripted</span></div>
    {active.length===0?<p>No exceptions detected in the available records. This does not establish complete coverage.</p>:active.map(f=><details key={f.id}><summary className="flex flex-wrap justify-between gap-3"><strong>{f.kind=== "Not verified"?"Eligibility needs review":f.kind}</strong><span>{f.amountCents===null?"Not verified":formatCents(f.amountCents)}</span></summary><p>{f.nextStep}</p><p className={styles.muted}>{f.owner} · {f.claimId}</p><p className={styles.note}>Evidence: {f.evidence.join(", ")}<br/>Term: {f.termId??"Missing or conflicting"} · Review pending</p></details>)}
   </section>
   <section className={styles.panel}><h2>Balances outside operational leakage</h2>{result.findings.filter(f=>["timing","economics"].includes(f.category)).map(f=><div key={f.id} className="py-3"><h3>{f.kind} · {formatCents(f.amountCents??0)}</h3><p>{f.nextStep}</p><p className={styles.note}>{f.claimId}</p></div>)}<p>Guarantee expense: <strong>{result.guaranteeExpenseCents===null?"Not verified":formatCents(result.guaranteeExpenseCents)}</strong>. Collections and guarantee expense are separate views of the same economics; they are not added together as savings.</p><p className={styles.note}>Realized savings: $0. Findings are exposures, not settled recoveries. Benefits and member access are unchanged.</p></section>
  </>:visibleTab==="evidence"?<section className={styles.panel}><h2>Claim-to-cash evidence</h2><p>Independent files are joined by claim ID. The detector receives transaction records and terms, with no scenario labels or expected findings.</p><div className={styles.tableWrap}><table><thead><tr><th>Claim</th><th>Manufacturer eligibility</th><th>Client guarantee</th><th>Units</th></tr></thead><tbody>{input.claims.filter(c=>c.recordedAt<=cutoff&&c.serviceAt<=cutoff).map(c=><tr key={c.id}><td>{c.id}{c.reversedAt&&c.reversedAt<=cutoff&&<small>Reversed</small>}</td><td>{c.manufacturerEligible===null?"Not verified":c.manufacturerEligible?"Eligible":"Excluded"}</td><td>{c.clientEligible===null?"Not verified":c.clientEligible?"Eligible":"Excluded"}</td><td>{c.units}</td></tr>)}</tbody></table></div>{(["terms","submissions","receipts","credits","guaranteeCredits"] as const).map(key=><details key={key}><summary>{({terms:"Contract terms",submissions:"Submission lines",receipts:"Manufacturer receipts",credits:"Employer credits",guaranteeCredits:"Noncash guarantee credits"})[key]}</summary><pre>{JSON.stringify(input[key].filter(r=>r.recordedAt<=cutoff&&(!("settledAt" in r)||!r.settledAt||r.settledAt<=cutoff)),null,2)}</pre></details>)}</section>:<section className={styles.panel}><h2>{profile.basis}</h2><p>{profile.note}</p><a href={profile.source} target="_blank" rel="noreferrer">{profile.citation} ↗</a>
   {sponsor==="tennessee"?<><p>The audit describes an annual obligation equal to the greater of minimum per-claim guarantees or manufacturer rebates collected. This demo uses that structure with assumed rates; it does not reproduce Tennessee’s actual financial position.</p><h3>Published audit observations</h3><p>$9,887.24 confirmed adjustments; $33,770.26 unconfirmed adjustments; $77,861 outstanding collections. Historical report figures, not this test’s results. The confirmed category includes an amount subsequently reconciled; it is not all unrecovered loss.</p><p>The report separates confirmed adjustments, unconfirmed adjustments and outstanding collections. Glass does not treat those categories as equivalent or claim to have independently rediscovered the historical findings.</p><p className={styles.note}>The signed contract and manufacturer terms remain unverified. <a href="https://www.tn.gov/partnersforhealth/contracts.html">Contract access information ↗</a></p></>:<p>Amendment 7A adds specified WAC differences to actual rebates for guarantee reconciliation. This test checks missing and overstated noncash credits using synthetic drug identifiers and WACs; these credits are not manufacturer cash.</p>}
   <h3>Scope of this check</h3><p>Automatic deterministic reconciliation of loaded records. Rates, due dates and transaction amounts are synthetic. Unknown eligibility blocks a complete financial position. An independent test fixture checks expected results outside the detector.</p><p>No submissions, payments, benefit changes or staff assignments are made. A clean result covers only the loaded records and implemented rules.</p></section>}
 </div>;
}
