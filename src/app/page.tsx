import Link from "next/link";
import { ArrowUpRight, ArrowRight } from "lucide-react";
import { ROLES } from "@/lib/roles";
import { signIn } from "@/app/actions/session";
import styles from "./welcome.module.css";

export const dynamic = "force-dynamic";

export default function WelcomePage() {
  return <main className={styles.page}>
    <header className={styles.header}><Link href="/" className={styles.brand}>glass <span>CVS Caremark</span></Link><span className={styles.demo}>Product concept · Demo data</span></header>
    <div className={styles.content}>
      <section className={styles.intro}><p className={styles.eyebrow}>PHARMACY BENEFITS, IN VIEW</p><h1>A clearer view<br/>of your plan.</h1><p className={styles.lead}>Costs you can follow. Guarantees you can track. Evidence you can inspect.</p><Link className={styles.primary} href="/sponsor">Open plan overview <ArrowRight size={16}/></Link><div className={styles.features}><Link href="/sponsor/assurance"><span>01</span> Money checks <ArrowUpRight size={16}/></Link><Link href="/reconciliation"><span>02</span> Contract performance <ArrowUpRight size={16}/></Link><Link href="/settlement"><span>03</span> Rebate collections <ArrowUpRight size={16}/></Link></div></section>
      <section className={styles.workspaces}><h2>Choose a workspace</h2><p>Explore the demo by role.</p>{ROLES.map(role => <form key={role.id} action={signIn}><input type="hidden" name="role" value={role.id}/><button type="submit"><span><strong>{role.label}</strong><small>{role.id === "sponsor" ? "Plan costs and performance" : role.id === "admin" ? "Benefits and operations" : role.id === "member" ? "Coverage and member service" : "Claims and pharmacy pricing"}</small></span><ArrowUpRight size={17}/></button></form>)}</section>
    </div>
    <footer className={styles.footer}>A CVS Caremark concept for small employers. Historical Wisconsin ETF / Navitus terms and simulated members support this demo; they are not Caremark pricing.<Link href="/methodology">Sources & assumptions <ArrowUpRight size={12}/></Link></footer>
  </main>;
}
