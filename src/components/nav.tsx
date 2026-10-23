"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bot,
  Building2,
  ClipboardCheck,
  FileInput,
  FileSearch,
  FlaskConical,
  Landmark,
  Map,
  MessageSquare,
  LineChart,
  Presentation,
  Radar,
  Receipt,
  Ruler,
  Scale,
  ScrollText,
  ShieldPlus,
  Smile,
  Stethoscope,
  Gauge,
  SlidersHorizontal,
  Store,
  TrendingUp,
  Undo2,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = {
  walkthrough: Map,
  pitch: Presentation,
  agents: Bot,
  sponsor: Building2,
  claims: Receipt,
  members: Users,
  changes: SlidersHorizontal,
  assistant: MessageSquare,
  dataAgent: LineChart,
  pa: ClipboardCheck,
  paReview: Stethoscope,
  reports: BarChart3,
  proof: FlaskConical,
  methodology: ScrollText,
  pos: Store,
  sources: FileSearch,
  operations: Activity,
  trends: TrendingUp,
  clinical: ShieldPlus,
  integrity: Radar,
  settlement: Landmark,
  reversals: Undo2,
  eligibility: FileInput,
  mac: Ruler,
  reconciliation: Scale,
  throughput: Gauge,
  experience: Smile,
} as const;

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  hint?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export function SideNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const query = params.toString();
  const offeringPages = ["/sponsor", "/offering", "/business"];
  const preserve = (href: string) => {if(href.startsWith('/workspace')&&params.get('employer')&&['/workspace','/onboarding'].includes(pathname)){const u=new URL(href,'https://sapphire.invalid');u.searchParams.set('employer',params.get('employer')!);return u.pathname+'?'+u.searchParams.toString();}return query && offeringPages.includes(pathname) && offeringPages.includes(href) ? `${href}?${query}` : href;};

  return (
    <nav className="flex flex-col gap-6 px-3 py-5">
      {groups.map((group) => (
        <div key={group.title}>
          <div className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-400">
            {group.title}
          </div>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active =
                (item.href.startsWith("/workspace") ? pathname === "/workspace" && (params.get("view")??"overview") === (new URL(item.href,"https://sapphire.invalid").searchParams.get("view")??"overview") : pathname === item.href) ||
                (item.href !== "/" && item.href !== "/sponsor" && pathname.startsWith(`${item.href}/`));
              return (
                <li key={item.href}>
                  <Link
                    href={preserve(item.href)}
                    prefetch={false}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] transition",
                      active
                        ? "bg-white font-medium text-ink-900 shadow-[0_1px_2px_rgba(18,22,31,0.06)] ring-1 ring-ink-200/70"
                        : "text-ink-600 hover:bg-white/70 hover:text-ink-900",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-[15px] w-[15px] shrink-0",
                        active
                          ? "text-glass-600"
                          : "text-ink-400 group-hover:text-ink-600",
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
