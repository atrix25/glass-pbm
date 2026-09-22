"use client";

import { useState } from "react";
import { rebateSensitivity, type RebatePeriod } from "@/lib/rebate-position";
import { formatCents, formatCentsCompact } from "@/lib/money";
import styles from "./sponsor-rebate-position.module.css";

export function SponsorRebatePosition({ monthly, quarterly }: { monthly: RebatePeriod[]; quarterly: RebatePeriod[] }) {
  const [cadence, setCadence] = useState<"monthly" | "quarterly">("quarterly");
  const [selectedId, setSelectedId] = useState("");
  const [variation, setVariation] = useState(5);
  const periods = cadence === "monthly" ? monthly : quarterly;
  const period = periods.find(p => p.id === selectedId) ?? periods.at(-1);
  if (!period) return null;
  const range = rebateSensitivity(period, variation);
  const money = (v: number | null) => v === null ? "—" : formatCents(Math.round(v));
  return <section className={styles.section} aria-labelledby="rebate-estimate-heading">
    <div className={styles.heading}><div><h3 id="rebate-estimate-heading">Rebate outlook</h3><p>Estimated earnings · Reconciliation pending</p></div><div className={styles.switch} aria-label="Rebate period grouping"><button type="button" aria-pressed={cadence==="monthly"} onClick={()=>{setCadence("monthly");setSelectedId("");}}>Monthly</button><button type="button" aria-pressed={cadence==="quarterly"} onClick={()=>{setCadence("quarterly");setSelectedId("");}}>Quarterly</button></div></div>
    <div className={styles.controls}><label>Period<select value={period.id} onChange={e=>setSelectedId(e.target.value)}>{[...periods].reverse().map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label><label>Sensitivity<select value={variation} onChange={e=>setVariation(Number(e.target.value))}><option value={5}>±5%</option><option value={10}>±10%</option><option value={15}>±15%</option></select></label><span>{period.closed ? "Period closed · Unreconciled" : "Period in progress"}</span></div>
    <div className={styles.values} aria-live="polite"><div><p>Estimated rate</p><strong>{money(range.rateCents)} <small>/ Rx</small></strong></div><div><p>Sensitivity range</p><strong>{money(range.lowRateCents)} – {money(range.highRateCents)}</strong></div><div><p>Contract floor</p><strong>{money(range.floorRateCents)} <small>/ Rx</small></strong></div></div>
    <div className={styles.summary}><span className={styles.position}>{range.position}</span><span>{formatCentsCompact(period.estimatedCents)} earned estimate · {period.claims.toLocaleString("en-US")} eligible Rx</span></div>
    <details><summary>Estimate basis</summary><p>Range applies ±{variation}% to this period’s earned estimate through the reporting date. It is an adjustable assumption, not a confidence interval or a full-period forecast. Monthly and quarterly controls regroup claims; they do not change contract terms.</p><p>Reconciliation results are not connected to these eligible claims. Closed periods remain unreconciled, and receipts do not establish final guarantee performance. No amount here is confirmed paid or owed. Each period uses its own eligible claims and service-date terms; category minimums and separate settlement rules still apply.</p></details>
    <p className={styles.note}>Assumed range · Not final settlement. Periods are views, not a confirmed reconciliation schedule.</p>
  </section>;
}
