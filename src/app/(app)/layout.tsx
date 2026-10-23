import Link from "next/link";
import {Diamond} from "lucide-react";
import {WorkspaceContext} from "@/components/workspace-context";
import {GemmaHeader} from "@/components/gemma";
import {demoFeaturesEnabled} from "@/lib/config";
import { Suspense } from "react";
import { ReferenceContext, ReferenceOnly } from "@/components/reference-context";
import { getClock, getRole, getActiveMemberId } from "@/lib/session";
import { RoleSwitcher } from "@/components/role-switcher";
import { SideNav, type NavGroup } from "@/components/nav";
import { DemoRail } from "@/components/demo-rail";
import { ClockBar } from "@/components/clock-bar";
import { AppShell } from "@/components/app-shell";
import { CopyLayer } from "@/components/copy-layer";
import { getCopyOverrides, copyIsPersistable } from "@/lib/copy";

const GROUPS: NavGroup[] = [
  {title: "Offering", items: [
    {href:"/benefit-changes",label:"Benefit changes",icon:"changes"},
    {href:"/gemma",label:"Sapphire activity",icon:"agents"},
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
    {href:"/changes",label:"Change console",icon:"changes"},
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
  const [role, clock, memberId] = await Promise.all([getRole(), getClock(), getActiveMemberId()]);
  const primary: Record<string,NavGroup[]> = {
 sponsor:[{title:"Your plan",items:[{href:"/workspace",label:"Overview",icon:"sponsor"},{href:"/plan-studio",label:"Build a plan",icon:"changes"},{href:"/workspace?view=members",label:"Members",icon:"members"},{href:"/workspace?view=claims",label:"Claims",icon:"claims"},{href:"/workspace?view=money",label:"Money",icon:"settlement"},{href:"/workspace?view=autopilot",label:"Autopilot",icon:"agents"}]}],
 admin:[{title:"Operations",items:[{href:"/operations",label:"Overview",icon:"operations"},{href:"/workspace",label:"Employers",icon:"sponsor"},{href:"/agents",label:"Work",icon:"agents"},{href:"/pa/review",label:"Clinical",icon:"paReview"},{href:"/settlement",label:"Money",icon:"settlement"},{href:"/gemma",label:"Sapphire",icon:"agents"}]}],
 member:[{title:"Your benefits",items:[{href:"/members/"+memberId,label:"My benefits",icon:"members"},{href:"/members/"+memberId+"#claims",label:"Prescriptions",icon:"claims"},{href:"/assistant",label:"Support",icon:"assistant"}]}],
 pharmacy:[{title:"Pharmacy",items:[{href:"/pos",label:"Submit claim",icon:"pos"},{href:"/claims",label:"Claim history",icon:"claims"},{href:"/mac",label:"Support",icon:"mac"}]}]
 };

  const sidebar = (
    <>
      <Link
        href="/workspace"
        className="flex items-center gap-2.5 border-b border-ink-200/70 px-4 py-[13px]"
      >
        <Diamond className="text-blue-700" size={24} strokeWidth={1.8}/>
        <span className="text-xl font-semibold tracking-tight text-ink-900">sapphire<span className="text-blue-700">.</span></span>
        <span className="mr-8 ml-auto rounded bg-ink-200/70 px-1.5 py-0.5 text-[10px] font-medium text-ink-600 lg:mr-0">
          Concept
        </span>
      </Link>

      <div className="scroll-thin flex-1 overflow-y-auto">
        <SideNav groups={primary[role]} />
        {(role==="admin"||role==="sponsor")&&<details className="mx-3 border-t border-slate-200 pt-4"><summary className="cursor-pointer px-3 text-xs font-medium text-slate-500">Reference workspaces</summary><SideNav groups={GROUPS}/></details>}
      </div>

      <div className="border-t border-ink-200/70 p-2.5">
        <RoleSwitcher current={role} />
      </div>
    </>
  );

  return (
    <AppShell sidebar={sidebar}>
      <WorkspaceContext date={clock.now.toISOString()}/>
      <ReferenceOnly><DemoRail /></ReferenceOnly>
      {demoFeaturesEnabled()&&(role==="admin"||role==="sponsor")&&<ReferenceOnly><Suspense fallback={null}><GemmaHeader/></Suspense></ReferenceOnly>}
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
