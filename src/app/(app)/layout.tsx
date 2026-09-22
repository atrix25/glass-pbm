import { demoFeaturesEnabled } from "@/lib/config";
import Link from "next/link";
import { getClock, getRole } from "@/lib/session";
import { RoleSwitcher } from "@/components/role-switcher";
import { SideNav, type NavGroup } from "@/components/nav";
import { DemoRail } from "@/components/demo-rail";
import { ClockBar } from "@/components/clock-bar";
import { AppShell } from "@/components/app-shell";
import { CopyLayer } from "@/components/copy-layer";
import { getCopyOverrides, copyIsPersistable } from "@/lib/copy";

const GROUPS: NavGroup[] = [
  {
    title: "Start here",
    items: [
      { href: "/pitch", label: "Plan sponsor pitch", icon: "pitch" },
      { href: "/walkthrough", label: "Guided walkthrough", icon: "walkthrough" },
    ],
  },
  {
    title: "Plan sponsor",
    items: [
      { href: "/sponsor", label: "Dashboard", icon: "sponsor" },
      { href: "/sponsor/assurance", label: "Assurance", icon: "integrity" },
      { href: "/claims", label: "Claim ledger", icon: "claims" },
      { href: "/members", label: "Membership", icon: "members" },
      { href: "/experience", label: "Member experience", icon: "experience" },
      { href: "/reports", label: "Reports", icon: "reports" },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/operations", label: "Live operations", icon: "operations" },
      { href: "/eligibility", label: "Eligibility feed", icon: "eligibility" },
      { href: "/trends", label: "Trend management", icon: "trends" },
      { href: "/pa", label: "Prior authorization", icon: "pa" },
      { href: "/pa/review", label: "Pharmacist review", icon: "paReview" },
      { href: "/changes", label: "Change console", icon: "changes" },
      { href: "/pos", label: "Pharmacy point of sale", icon: "pos" },
    ],
  },
  {
    title: "Clinical and integrity",
    items: [
      { href: "/clinical", label: "Clinical safety", icon: "clinical" },
      { href: "/integrity", label: "Program integrity", icon: "integrity" },
    ],
  },
  {
    title: "Money movement",
    items: [
      { href: "/settlement", label: "Settlement", icon: "settlement" },
      { href: "/reversals", label: "Reversals and recoveries", icon: "reversals" },
      { href: "/mac", label: "MAC and appeals", icon: "mac" },
      { href: "/reconciliation", label: "Guarantee reconciliation", icon: "reconciliation" },
    ],
  },
  {
    title: "Agents",
    items: [
      { href: "/account-management", label: "Account management", icon: "changes" },
      ...(demoFeaturesEnabled() ? [{ href: "/rebate-protection", label: "Rebate protection", icon: "integrity" as const }] : []),
      { href: "/agents", label: "Agent operations", icon: "agents" },
      { href: "/assistant", label: "Member service", icon: "assistant" },
      ...(demoFeaturesEnabled() ? [{ href: "/member-calls", label: "Member calls", icon: "assistant" as const }] : []),
      { href: "/data-agent", label: "Data agent", icon: "dataAgent" },
    ],
  },
  {
    title: "Evidence",
    items: [
      { href: "/proof", label: "Correctness proof", icon: "proof" },
      { href: "/throughput", label: "Throughput", icon: "throughput" },
      { href: "/sources", label: "Source documents", icon: "sources" },
      { href: "/methodology", label: "Methodology", icon: "methodology" },
    ],
  },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [role, clock, copy, copyPersistable] = await Promise.all([
    getRole(),
    getClock(),
    getCopyOverrides(),
    copyIsPersistable(),
  ]);

  const sidebar = (
    <>
      <Link href="/sponsor" className="border-b border-ink-100 px-6 py-6 text-2xl font-semibold tracking-[-1px] text-ink-900">glass <span className="ml-3 text-[10px] font-medium tracking-normal text-rose-700">CVS Caremark</span></Link>

      <div className="scroll-thin flex-1 overflow-y-auto">
        <SideNav groups={GROUPS} />
      </div>

      <div className="border-t border-ink-200/70 p-2.5">
        <RoleSwitcher current={role} />
      </div>
    </>
  );

  return (
    <AppShell sidebar={sidebar}>
      <details className="mx-auto mt-3 w-full max-w-[1180px] px-4 text-[11px] text-ink-500" data-operations-chrome>
        <summary className="cursor-pointer py-1">Demo controls · {clock.now.toISOString().slice(0, 10)}{clock.pinned ? " · Pinned" : ""}</summary>
        <div className="mt-2 overflow-hidden rounded-lg border border-ink-200 bg-white"><DemoRail /><div className="p-3"><ClockBar clock={clock} /></div></div>
      </details>
      <main id="main-content" className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
        <div className="mx-auto w-full max-w-[1180px]">{children}</div>
      </main>

      <CopyLayer overrides={copy} persistable={copyPersistable} />
    </AppShell>
  );
}
