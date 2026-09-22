import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getClock } from "@/lib/session";
import { getSponsorOverview } from "@/lib/queries/sponsor-overview";
import { SponsorCostChart } from "@/components/sponsor-cost-chart";
import { SponsorRebatePosition } from "@/components/sponsor-rebate-position";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { formatNumber } from "@/lib/utils";
import { getGuaranteePosition } from "@/lib/queries/guarantee-position";
import type { GuaranteeMeasure } from "@/lib/guarantee-position";
import styles from "./sponsor.module.css";

export const dynamic = "force-dynamic";

export default async function SponsorDashboard() {
  const clock = await getClock();
  const data = await getSponsorOverview(clock);
  const position = await getGuaranteePosition(clock);
  const shortfallCategories = position.categories.filter(c => c.measures.some(m => m.status === "Below target")).length;
  const money = (value: number | null) => value === null ? "—" : formatCents(value);
  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>{data.sponsor} / {data.year}</p><h1>Plan overview</h1><p className={styles.muted}>As of {data.asOf}</p></div>
        <Link href="/reports" className={styles.button}>Reports <ArrowUpRight size={14} /></Link>
      </header>

      <div className={styles.metrics}>
        <section><p>Net plan cost</p><div className={styles.value}>{money(data.pmpmCents)} <span>PMPM</span></div><small>{formatCentsCompact(data.netCents)} year to date</small></section>
        <section><p>Annualized cost</p><div className={styles.value}>{data.runRateCents === null ? "—" : formatCentsCompact(data.runRateCents)}</div><small>Run rate · No forecast adjustments</small></section>
        <section><p>Member out-of-pocket</p><div className={styles.value}>{money(data.oopPmpmCents)} <span>PMPM</span></div><small>{formatCentsCompact(data.oopCents)} year to date</small></section>
      </div>
      <div className={styles.primary}>
        <section id="cost" className={styles.panel}>
          <div className={styles.panelHeading}><h2>Cost trend</h2><span className={styles.muted}>Net PMPM</span></div>
          <SponsorCostChart data={data.trend.map(m => ({ month: m.month, pmpmCents: m.pmpmCents, complete: m.complete }))} currentPmpmCents={data.pmpmCents} budgetKey={`${data.sponsor}:${data.year}`} />
        </section>
        <section className={styles.panel}><h2>Plan review</h2>
          <ReviewLink href="/sponsor/assurance" title="Money checks" detail="Charges, rebates and supporting evidence" />
          <ReviewLink href="/trends" title="Cost drivers" detail="Drug mix, prices and utilization" />
          <ReviewLink href="/reconciliation" title="Contract performance" detail="Pricing, service and credits" />
          <ReviewLink href="/settlement" title="Rebate collections" detail="Receipts and outstanding balances" />
        </section>
      </div>
      <section className={`${styles.panel} ${styles.guarantees}`} aria-labelledby="guarantee-heading">
        <div className={styles.panelHeading}><div><h2 id="guarantee-heading">Guarantee position</h2><p className={styles.muted}>Year to date · {data.asOf} · Provisional</p></div><Link href="/reconciliation" className={styles.textLink}>Reconciliation <ArrowUpRight size={13}/></Link></div>
        <div className={styles.guaranteeTable}><table><thead><tr><th>Measure</th><th>Target</th><th>To date</th><th>Margin</th><th>Position</th></tr></thead><tbody>{position.measures.map(m=><GuaranteeRow key={m.id} measure={m}/>)}</tbody></table></div>
        <p className={styles.muted}>Effective discount uses the AWP-weighted category targets. Rebates are estimates; fees are a ceiling.</p>
        <SponsorRebatePosition monthly={position.monthlyRebates} quarterly={position.quarterlyRebates} />
        {shortfallCategories > 0 && <p className={styles.shortfall}>{shortfallCategories} {shortfallCategories === 1 ? "category has" : "categories have"} a shortfall. See category detail.</p>}
        <details className={styles.details}><summary>Channel & category detail</summary>{position.categories.map(c=><div key={c.name} className={styles.category}><h3>{c.name}{c.belowMinimum ? " · Below minimum volume" : ""}</h3><div className={styles.guaranteeTable}><table><thead><tr><th>Measure</th><th>Target</th><th>To date</th><th>Margin</th><th>Position</th></tr></thead><tbody>{c.measures.map(m=><GuaranteeRow key={m.id} measure={m}/>)}</tbody></table></div>{c.citations.length>0&&<p>{c.citations.join("; ")}</p>}</div>)}</details>
        <details className={styles.details}><summary>Service guarantees</summary><Amount label="Prior authorization & eligibility" value="Demo scorecard"/><Amount label="Claims accuracy" value="Demo scorecard"/><Amount label="Call response, abandonment & resolution" value="Not connected"/><Amount label="Mail accuracy & turnaround" value="Not connected"/><Amount label="Reporting & account service" value="Contract and data needed"/><Link href="/reconciliation" className={styles.textLink}>Service scorecard ↗</Link></details>
        <details className={styles.details}><summary>Calculation basis</summary><p>Recalculated on page load for the selected clock. Commercial claims only; recorded reversals and contract exclusions are removed. Category targets follow the service-date rate. Missing or conflicting terms remain unmeasured. {formatNumber(position.excludedClaims)} claims excluded from discount and fee calculations. {formatNumber(position.simulatedClaims)} eligible claims use simulated AWP.</p><p>Demo category minimum: {formatNumber(position.minClaims)} claims. The overall blend is a monitoring reference, not a separate contracted guarantee. Category shortfalls are not offset against other categories. Final credits require contract reconciliation; no projected or settled credit is included here.</p></details>
      </section>
      <div className={styles.secondary}>
        <section className={styles.panel}><div className={styles.panelHeading}><h2>Plan costs</h2><span className={styles.muted}>Year to date</span></div>
          <Amount label="Plan-paid claims" value={formatCents(data.planCents)} />
          <Amount label="Estimated fees" value={formatCents(data.feesCents)} />
          <Amount label="Estimated rebates" value={`− ${formatCents(data.rebateCents)}`} />
          <div className={styles.total}><Amount label="Net plan cost" value={formatCents(data.netCents)} /></div>
          <details className={styles.details}><summary>Cost basis</summary><p>Claims and rebates include recorded reversals. Fees use calendar-month eligibility and the demo commercial rate, including the rebate administration fee. Accrued cost is not cash paid.</p></details>
        </section>
        <section className={styles.panel}><div className={styles.panelHeading}><h2>Member activity</h2><Link href="/members" className={styles.textLink}>Details <ArrowUpRight size={13} /></Link></div>
          <Amount label="Prescriptions, net of reversals" value={formatNumber(data.claims)} />
          <Amount label="Eligible member-months" value={formatNumber(Math.round(data.memberMonths))} />
          <Amount label="Member out-of-pocket" value={formatCents(data.oopCents)} />
          <div className={styles.links}><Link href="/clinical">Clinical programs <ArrowUpRight size={13}/></Link><Link href="/experience">Access & experience <ArrowUpRight size={13}/></Link></div>
        </section>
      </div>
      <details className={styles.sources}><summary>Data & methodology</summary><p>Demo book · {data.pbm} · {data.contract}. These are historical demo terms, not Caremark pricing. PMPM uses eligible calendar member-months, with overlapping coverage counted once. Annualized cost extends the average completed month; it excludes future drug changes, guarantee credits and enrollment changes. Forecasts, clinical outcomes and integrated medical value are not yet connected.</p></details>
    </div>
  );
}
function Amount({ label, value }: { label: string; value: string }) { return <div className={styles.amount}><span>{label}</span><span>{value}</span></div>; }
function ReviewLink({ href, title, detail }: { href: string; title: string; detail: string }) { return <Link href={href} className={styles.review}><div><h3>{title}</h3><p>{detail}</p></div><ArrowUpRight size={15}/></Link>; }

function GuaranteeRow({ measure: m }: { measure: GuaranteeMeasure }) {
  const value = (v: number | null) => v === null ? "—" : m.unit === "percent" ? `${v.toFixed(2)}%` : `${formatCents(Math.round(v))} / Rx`;
  const pendingRebate = m.id === "rebate" && m.actual !== null;
  const status = pendingRebate ? "Unreconciled" : m.status === "Above target" ? "Favorable" : m.status === "Below target" ? "Shortfall" : m.status;
  return <tr><td><span>{m.name}</span><small>{formatNumber(m.claims)} eligible Rx{m.missingClaims ? ` · ${formatNumber(m.missingClaims)} unmeasured` : ""}</small></td><td>{value(m.target)}</td><td>{value(m.actual)}{pendingRebate && <small>Estimated</small>}</td><td>{m.gap===null?"—":m.unit==="percent"?`${m.gap>=0?"+":"−"}${Math.abs(m.gap).toFixed(2)} pp`:`${m.gap>=0?"+":"−"}${formatCents(Math.round(Math.abs(m.gap)))} / Rx`}</td><td><span className={pendingRebate?styles.muted:m.status==="Below target"?styles.shortfall:m.gap!==null?styles.favorable:styles.muted}>{status}</span></td></tr>;
}
