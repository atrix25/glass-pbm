"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./sponsor-shell.module.css";

const sections = [
  ["/sponsor", "Overview"], ["/trends", "Cost & utilization"],
  ["/reconciliation", "Guarantees"], ["/settlement", "Rebates"],
  ["/experience", "Members"], ["/sponsor/assurance", "Assurance"],
  ["/reports", "Reports"],
] as const;

export function AppShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.close(); }, [pathname]);
  function close() { dialog.current?.close(); }
  return <div className={styles.shell}>
    <a href="#main-content" className={styles.skip}>Skip to content</a>
    <header className={styles.header}>
      <Link href="/sponsor" className={styles.brand} aria-label="Glass sponsor overview">glass <span>CVS Caremark</span></Link>
      <div className={styles.tools}><span className={styles.demo}>Demo data</span><Link href="/operations">Operations</Link><button onClick={() => dialog.current?.showModal()} aria-label="Open workspace navigation" aria-haspopup="dialog"><Menu size={16}/><span>Workspace</span></button></div>
    </header>
    <div className={styles.navFrame}><nav className={styles.tabs} aria-label="Sponsor sections">{sections.map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>{label}</Link>)}</nav></div>
    <dialog ref={dialog} className={styles.drawer} aria-label="Workspace navigation" onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className={styles.drawerBody} onClick={event => { if ((event.target as HTMLElement).closest("a")) close(); }}>
        <button className={styles.close} onClick={close} aria-label="Close workspace navigation"><X size={18}/></button>
        {sidebar}
      </div>
    </dialog>
    {children}
  </div>;
}
