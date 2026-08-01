import Link from "next/link";
import { getRole } from "@/lib/session";
import { RoleSwitcher } from "@/components/role-switcher";
import { SideNav, type NavGroup } from "@/components/nav";
import { DemoRail } from "@/components/demo-rail";

const GROUPS: NavGroup[] = [
  {
    title: "Plan sponsor",
    items: [
      { href: "/sponsor", label: "Dashboard", icon: "sponsor" },
      { href: "/claims", label: "Claim ledger", icon: "claims" },
      { href: "/members", label: "Membership", icon: "members" },
      { href: "/reports", label: "Reports", icon: "reports" },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/changes", label: "Change console", icon: "changes" },
      { href: "/pa", label: "Prior authorization", icon: "pa" },
      { href: "/pos", label: "Pharmacy point of sale", icon: "pos" },
    ],
  },
  {
    title: "Member service",
    items: [{ href: "/assistant", label: "AI member service", icon: "assistant" }],
  },
  {
    title: "Evidence",
    items: [
      { href: "/proof", label: "Correctness proof", icon: "proof" },
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
  const role = await getRole();

  return (
    <div className="flex min-h-screen bg-ink-50/70">
      <aside className="sticky top-0 flex h-screen w-[236px] shrink-0 flex-col border-r border-ink-200/80 bg-ink-100/40">
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
          <span className="ml-auto rounded bg-ink-200/70 px-1.5 py-0.5 text-[10px] font-medium text-ink-600">
            ETG0013
          </span>
        </Link>

        <div className="scroll-thin flex-1 overflow-y-auto">
          <SideNav groups={GROUPS} />
        </div>

        <div className="border-t border-ink-200/70 p-2.5">
          <RoleSwitcher current={role} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <DemoRail />
        <main className="flex-1 px-8 py-7">
          <div className="mx-auto w-full max-w-[1180px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
