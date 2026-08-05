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
      { href: "/walkthrough", label: "Guided walkthrough", icon: "walkthrough" },
    ],
  },
  {
    title: "Plan sponsor",
    items: [
      { href: "/sponsor", label: "Dashboard", icon: "sponsor" },
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
      { href: "/agents", label: "Agent operations", icon: "agents" },
      { href: "/assistant", label: "AI member service", icon: "assistant" },
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
      <Link
        href="/sponsor"
        className="flex items-center gap-2.5 border-b border-ink-200/70 px-4 py-[13px]"
      >
        <span className="relative flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-glass-400 to-glass-700">
          <span className="h-2.5 w-2.5 rounded-[2px] border-[1.5px] border-white/90" />
        </span>
        <span className="text-[14px] font-semibold tracking-tight text-ink-900">
          Glass
        </span>
        <span className="mr-8 ml-auto rounded bg-ink-200/70 px-1.5 py-0.5 text-[10px] font-medium text-ink-600 lg:mr-0">
          ETG0013
        </span>
      </Link>

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
      <DemoRail />
      <div className="border-b border-ink-200/70 bg-white/60 px-4 py-2 sm:px-6 lg:px-8">
        <ClockBar clock={clock} />
      </div>
      <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
        <div className="mx-auto w-full max-w-[1180px]">{children}</div>
      </main>

      <CopyLayer overrides={copy} persistable={copyPersistable} />
    </AppShell>
  );
}
