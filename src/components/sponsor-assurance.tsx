"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDownToLine, ArrowUpRight, Check, Minus, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import type { AssuranceCheck, AssuranceStatus } from "@/lib/assurance";
import styles from "./sponsor-assurance.module.css";

type Snapshot = {
  sponsor: string; contract: string; checkedAt: string; asOf: string;
  latestClaimAt: string | null; periodStart: string; checks: AssuranceCheck[]; scope: string;
};
const statuses: AssuranceStatus[] = ["Clear", "Review", "Not verified"];
const groups = ["Charges & fees", "Rebates & settlement", "Evidence"] as const;
const date = (value: string) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const time = (value: string) => new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const number = (value: number | null) => value === null ? "—" : value.toLocaleString("en-US");

export function SponsorAssurance({ data }: { data: Snapshot }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<AssuranceStatus | "All">("All");
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, ...data }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = `glass-assurance-${data.checkedAt.slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>PLAN ASSURANCE</p><h1>Follow the money.</h1><p className={styles.muted}>Charges, rebates and the evidence behind them.</p></div><div className={styles.actions}><button onClick={download}><ArrowDownToLine size={15}/> Export checks</button><button disabled={pending} onClick={() => startTransition(() => router.refresh())}><RefreshCw size={15} className={pending ? styles.spinning : undefined}/>{pending ? "Checking…" : "Run checks"}</button></div></header>

    <section className={styles.summary} aria-label="Check results">
      <div className={styles.scope}><ShieldCheck size={24} strokeWidth={1.5}/><h2>Open books.<br/>{" "}Visible exceptions.</h2><p>Checks run on page load or refresh.<br/>Independent evidence stays separate.</p></div>
      {statuses.map(status => <button key={status} className={styles.stat} aria-pressed={filter === status} onClick={() => setFilter(filter === status ? "All" : status)}><span className={styles.statLabel}><StatusIcon status={status}/>{status}</span><strong>{data.checks.filter(c => c.status === status).length}</strong><small>{status === "Clear" ? "Recorded checks passed" : status === "Review" ? "Exceptions to resolve" : "Evidence still needed"}</small></button>)}
    </section>
    <div className={styles.meta}><span>{date(data.periodStart)} – {date(data.asOf)} · {data.sponsor}</span><span role="status">{pending ? "Checking source records…" : `Checked ${time(data.checkedAt)}`}</span></div>
    <div className={styles.notice}><span className={styles.dot}/><p><strong>Demo data.</strong> Automated checks, not an independent audit. A clear result covers only the test shown.</p></div>
    <section aria-label="Assurance checks" aria-busy={pending}>
      <div className={styles.listHeader}><h2>Assurance checks <span>{data.checks.length}</span></h2><div className={styles.filters} aria-label="Filter checks">{(["All", ...statuses] as const).map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</div></div>
      {groups.map(group => {
        const checks = data.checks.filter(c => c.group === group && (filter === "All" || c.status === filter));
        return checks.length ? <section className={styles.group} key={group}><h3>{group}</h3>{checks.map(check => <details key={check.id} className={styles.check}>
          <summary><span className={`${styles.icon} ${styles[tone(check.status)]}`}><StatusIcon status={check.status}/></span><span className={styles.checkTitle}><strong>{check.title}</strong><span>{check.result}</span></span><span className={`${styles.badge} ${styles[tone(check.status)]}`}>{check.status}</span><span className={styles.expand}>+</span></summary>
          <div className={styles.evidence}><div className={styles.evidenceGrid}><div><h4>Test</h4><p>{check.method}</p><h4>Source</h4><Link href={check.href}>{check.source} <ArrowUpRight size={12}/></Link></div><dl><div><dt>Records checked</dt><dd>{number(check.records)}</dd></div><div><dt>Exceptions</dt><dd>{number(check.exceptions)}</dd></div>{check.differenceCents !== null && <div><dt>Absolute difference</dt><dd>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(check.differenceCents / 100)}</dd></div>}</dl></div><div className={styles.limit}><h4>Coverage</h4><p>{check.limit}</p></div><div><h4>Next step</h4><p>{check.nextStep}</p></div></div>
        </details>)}</section> : null;
      })}
      {!data.checks.some(c => filter === "All" || c.status === filter) && <p className={styles.notice}>No checks in this category.</p>}
    </section>
    <footer className={styles.footer}><span>Latest claim {data.latestClaimAt ? time(data.latestClaimAt) : "unavailable"}</span><span>Differences may overlap. Do not add them together.</span><details><summary>Scope & sources</summary><p>{data.contract}. Current-year records through the selected data cutoff; accepted reversals are removed. External cash receipts, affiliate revenue and executed terms require separate evidence. Exports contain aggregate checks only.</p></details></footer>
  </div>;
}
function tone(status: AssuranceStatus) { return status === "Clear" ? "clear" : status === "Review" ? "review" : "unknown"; }
function StatusIcon({ status }: { status: AssuranceStatus }) { return status === "Clear" ? <Check size={15}/> : status === "Review" ? <TriangleAlert size={15}/> : <Minus size={15}/>; }
