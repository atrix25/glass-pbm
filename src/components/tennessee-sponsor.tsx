import Link from "next/link";
import { evidenceFor, DEFAULT_CUTOFF } from "@/lib/contract-checks/evidence";
import { detect } from "@/lib/contract-checks/detector";
import { PROFILES } from "@/lib/contract-checks/profiles";
import { formatCents } from "@/lib/money";
import styles from "./rebate-protection.module.css";
export function TennesseeSponsor({assurance=false}:{assurance?:boolean}){
 const result=detect(evidenceFor("tennessee"),`${DEFAULT_CUTOFF.tennessee}T00:00:00.000Z`);
 return <div className={styles.page}><header className={styles.header}><div><span className={styles.eyebrow}>Tennessee · CVS Caremark</span><h1>{assurance?"Rebate delivery":"Plan overview"}</h1><p className={styles.muted}>2022 audit period · Synthetic transaction demonstration</p></div><span className={styles.badge}>Audit-derived terms</span></header>
 <section className={styles.panel}><h2>{assurance?"Employer entitlement":"Rebate protection"}</h2><p>{assurance?"Every dollar owed to the employer remains payable. Missing terms prevent verification of the full guarantee obligation.":"Glass checks the loaded claims, submissions and payments against the configured terms. Five items need attention."}</p><Link href="/rebate-protection">Open contract checks →</Link></section>
 <div className={styles.metrics}><article><span>Manufacturer receipts</span><strong>{formatCents(result.cashCents)}</strong><small>Active claims · Synthetic</small></article><article><span>Employer credits</span><strong>{formatCents(result.employerCreditsCents)}</strong><small>Active claims · Synthetic</small></article><article><span>Collected, not credited</span><strong>{formatCents(result.employerOutstandingCents)}</strong><small>Owed to the employer</small></article><article><span>Guarantee obligation</span><strong className="!text-xl">Not verified</strong><small>Missing eligibility evidence</small></article></div>
 <section className={styles.panel}><h2>Evidence scope</h2><p>The public audit describes the greater of minimum rebate guarantees or manufacturer rebates collected. Actual contract rates and transaction files are not loaded. Plan cost, utilization and member outcomes are not available for this sponsor.</p><p>Amounts above use synthetic records at March 31, 2023. A $100 credit on a reversed claim is excluded from active-claim totals and flagged for review.</p><a href={PROFILES.tennessee.source}>Published Tennessee audit ↗</a></section></div>;
}
