import Link from "next/link";
import {GemmaHeader} from "@/components/gemma";
import {demoFeaturesEnabled} from "@/lib/config";
import { Suspense } from "react";
import { ReferenceContext, ReferenceOnly } from "@/components/reference-context";
import { getClock, getRole } from "@/lib/session";
import { RoleSwitcher } from "@/components/role-switcher";
import { SideNav, type NavGroup } from "@/components/nav";
import { DemoRail } from "@/components/demo-rail";
import { ClockBar } from "@/components/clock-bar";
import { AppShell } from "@/components/app-shell";
import { CopyLayer } from "@/components/copy-layer";
import { getCopyOverrides, copyIsPersistable } from "@/lib/copy";

const GROUPS: NavGroup[] = [
  {title: "Offering", items: [
    {href:"/gemma",label:"Gemma activity",icon:"agents"},
    {href:"/sponsor",label:"Plan outlook",icon:"sponsor"},
    {href:"/savings",label:"Find savings",icon:"trends"},
    {href:"/offering",label:"Pricing & benefits",icon:"changes"},
    {href:"/business",label:"Caremark economics",icon:"reports"},
    {href:"/pitch",label:"Product overview",icon:"pitch"},
  ]},
  {title:"Reference operations",items:[
    {href:"/agents",label:"Agent operations",icon:"agents"},
    {href:"/operations",label:"Work queues",icon:"operations"},
    {href:"/eligibility",label:"Enrollment",icon:"eligibility"},
    {href:"/changes",label:"Benefit changes",icon:"changes"},
    {href:"/trends",label:"Trend & renewal",icon:"trends"},
    {href:"/assistant",label:"Member service",icon:"assistant"},
    {href:"/pa",label:"Prior authorization",icon:"pa"},
    {href:"/pa/review",label:"Clinical review",icon:"paReview"},
    {href:"/clinical",label:"Clinical safety",icon:"clinical"},
    {href:"/integrity",label:"Program integrity",icon:"integrity"},
    {href:"/data-agent",label:"Data agent",icon:"dataAgent"},
  ]},
  {title:"Reference book",items:[
    {href:"/sponsor/reference",label:"Book overview",icon:"sponsor"},
    {href:"/claims",label:"Claims",icon:"claims"},
    {href:"/members",label:"Members",icon:"members"},
    {href:"/experience",label:"Member experience",icon:"experience"},
    {href:"/pos",label:"Point of sale",icon:"pos"},
    {href:"/settlement",label:"Settlement",icon:"settlement"},
    {href:"/reversals",label:"Reversals",icon:"reversals"},
    {href:"/mac",label:"MAC & appeals",icon:"mac"},
    {href:"/reconciliation",label:"Reconciliation",icon:"reconciliation"},
    {href:"/reports",label:"Reports",icon:"reports"},
    {href:"/sources",label:"Source documents",icon:"sources"},
    {href:"/proof",label:"Engine tests",icon:"proof"},
    {href:"/throughput",label:"Throughput",icon:"throughput"},
    {href:"/methodology",label:"Methodology",icon:"methodology"},
  ]},
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [role, clock] = await Promise.all([getRole(), getClock()]);

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
          Concept
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
      {demoFeaturesEnabled()&&<Suspense fallback={null}><GemmaHeader/></Suspense>}
      <ReferenceContext />
      <ReferenceOnly><div className="border-b border-ink-200/70 bg-white/60 px-4 py-2 sm:px-6 lg:px-8">
        <ClockBar clock={clock} />
      </div></ReferenceOnly>
      <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
        <div className="mx-auto w-full max-w-[1180px]">{children}</div>
      </main>

      <Suspense fallback={null}><CopySettings /></Suspense>
    </AppShell>
  );
}

async function CopySettings(){const [copy,persistable]=await Promise.all([getCopyOverrides(),copyIsPersistable()]);return <CopyLayer overrides={copy} persistable={persistable}/>;}
