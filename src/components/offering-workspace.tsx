import Link from 'next/link';
import { ArrowUpRight, ArrowRight, Check, SlidersHorizontal } from 'lucide-react';
import { Card, CardHeader, Stat, SectionTitle } from '@/components/ui';
import { calculateOffering, offeringQuery, PACKAGES, OFFERING_VERSION, type OfferingInput } from '@/lib/offering/model';
import { formatCents } from '@/lib/money';

const button='inline-flex items-center justify-center gap-2 rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-700 focus-visible:outline-2 focus-visible:outline-offset-4';
const field='mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900';
export function OfferingWorkspace({input,view}:{input:OfferingInput;view:'sponsor'|'offering'|'business'}) {
  const x=calculateOffering(input), query=offeringQuery(input);
  const link=(path:string)=>`${path}?${query}`;
  const annual=(value:number)=>value*input.members*12;
  const under=x.budgetAnnual-x.employerAnnual;
  return <div className="space-y-6">
    <SectionTitle description="Caremark small-employer concept · Illustrative planning, not a client quote" action={<span className="whitespace-nowrap rounded-full border border-glass-200 bg-glass-50 px-3 py-1.5 text-xs font-medium text-glass-800">{input.members} covered lives</span>}>
      {view==='sponsor'?'Plan outlook':view==='offering'?'Build the offering':'Business outlook'}
    </SectionTitle>
    <nav aria-label="Offering views" className="flex flex-wrap gap-2 border-b border-ink-200 pb-3">
      {[['sponsor','Plan outlook'],['offering','Pricing & benefits'],['business','Caremark economics']].map(([id,label])=><Link key={id} href={link('/'+id)} aria-current={view===id?'page':undefined} className={`rounded-lg px-4 py-2 text-sm ${view===id?'bg-ink-900 text-white':'text-ink-600 hover:bg-ink-100'}`}>{label}</Link>)}
    </nav>
    {view!=='offering' && <>
      <Card><div className="grid divide-ink-200 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x">
        {view==='sponsor'?<>
          <Stat label="Net cost PMPM" value={formatCents(x.net)} sub="After rebates, top-ups and service fees"/>
          <Stat label="Annual employer cost" value={formatCents(x.employerAnnual)} sub="12-month planning estimate"/>
          <Stat label="Member cost PMPM" value={formatCents(x.member)} sub={`${PACKAGES[input.benefits].memberShareBps/100}% aggregate member share assumption`}/>
          <Stat label="Budget position" value={formatCents(Math.abs(under))} sub={under>=0?'Below the annual planning budget':'Above the annual planning budget'} tone={under>=0?'positive':'negative'}/>
        </>:<>
          <Stat label="Annual fee revenue" value={formatCents(x.feesAnnual)} sub="Employer service fees only"/>
          <Stat label="Annual cost to serve" value={formatCents(x.operatingAnnual)} sub="Staff, technology and allocated overhead"/>
          <Stat label="Guarantee funding" value={formatCents(x.topUpAnnual)} sub="PBM-funded; distinct from manufacturer rebates"/>
          <Stat label="Annual contribution" value={formatCents(x.contributionAnnual)} sub="Fees less modeled operating costs and top-ups" tone={x.contributionAnnual>=0?'positive':'negative'}/>
        </>}
      </div></Card>
      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Card><CardHeader title={view==='sponsor'?'Cost, step by step':'Account economics'} description="Annual amounts · Same assumptions across all views"/>
          <dl className="divide-y divide-ink-100 px-5">
            {(view==='sponsor'?[
              ['Gross drug cost',annual(x.gross)],['Member contributions',-annual(x.member)],['Manufacturer rebates',-x.rebatesAnnual],['PBM-funded top-ups',-x.topUpAnnual],['Service fees',x.feesAnnual],['Net employer cost',x.employerAnnual],
            ]:[['Service fees',x.feesAnnual],['Staff cost',-annual(Math.round(input.labor*100))],['Technology',-annual(Math.round(input.platform*100))],['Allocated overhead',-annual(Math.round(input.overhead*100))],['Guarantee funding',-x.topUpAnnual],['Contribution',x.contributionAnnual]]).map(([label,value],i)=><div key={label} className={`flex items-center justify-between gap-4 py-3.5 text-sm ${i===5?'font-semibold text-ink-950':'text-ink-600'}`}><dt>{label}</dt><dd className="tnum">{formatCents(Number(value) || 0)}</dd></div>)}
          </dl>
        </Card>
        <div className="space-y-6">
          <Card><CardHeader title="Selected offering"/><div className="space-y-4 p-5 text-sm">
            <div><p className="font-semibold text-ink-900">{input.model==='truecost'?'TrueCost concept':'Drug-level rebate concept'}</p><p className="mt-1 text-ink-500">{input.model==='truecost'?'Acquisition benchmark plus pharmacy compensation.':'Contracted client drug pricing with explicit rebate values.'}</p></div>
            <div className="flex items-center gap-2 text-glass-800"><Check size={16}/>100% of modeled manufacturer rebates credited</div>
            <div className="border-t border-ink-100 pt-4"><p className="font-medium">{PACKAGES[input.benefits].name}</p><p className="mt-1 text-ink-500">{PACKAGES[input.benefits].summary}</p></div>
            <Link href={link('/offering')} className={button}>Adjust assumptions <SlidersHorizontal size={15}/></Link>
          </div></Card>
          <Card><CardHeader title="Sensitivity" description="Assumptions, not a confidence interval"/><div className="p-5"><p className="text-xl font-semibold tracking-tight">{formatCents(view==='sponsor'?x.favorable.employer:x.adverse.contribution)} – {formatCents(view==='sponsor'?x.adverse.employer:x.favorable.contribution)}</p><p className="mt-2 text-xs leading-relaxed text-ink-500">Annual {view==='sponsor'?'employer cost':'contribution'} with gross drug cost ±10% and manufacturer rebates ∓15%. The assumed rebate floor remains payable.</p></div></Card>
        </div>
      </div>
    </>}
    {view==='offering' && <>
      <div className="rounded-xl bg-ink-900 p-6 text-white sm:flex sm:items-center sm:justify-between"><div><p className="text-xs text-white/60">CURRENT SCENARIO</p><p className="mt-2 text-3xl font-semibold tracking-tight">{formatCents(x.net)} <span className="text-base font-normal text-white/60">net PMPM</span></p></div><p className="mt-3 text-sm text-white/70 sm:mt-0">{formatCents(x.employerAnnual)} annual employer cost</p></div>
      <form action="/offering" method="get" className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card><CardHeader title="Employer & pricing"/><div className="grid gap-4 p-5 sm:grid-cols-2">
            <NumberField name="members" label="Covered lives" value={input.members} min={1} max={1000} step="1"/>
            <NumberField name="budget" label="Employer budget · $ PMPM" value={input.budget}/>
            <label className="text-sm sm:col-span-2">Pricing arrangement<select name="model" defaultValue={input.model} className={field}><option value="truecost">TrueCost concept</option><option value="drug-rebate">Drug-level rebate concept</option></select></label>
            <NumberField name="acquisition" label="Acquisition benchmark · $ PMPM" value={input.acquisition}/>
            <NumberField name="pharmacy" label="Pharmacy compensation · $ PMPM" value={input.pharmacy}/>
            <NumberField name="drugPrice" label="Client drug price · $ PMPM" value={input.drugPrice}/>
            <NumberField name="fee" label="Service fee · $ PMPM" value={input.fee}/>
            <p className="text-xs leading-relaxed text-ink-500 sm:col-span-2">TrueCost concept uses acquisition plus pharmacy compensation. Drug-level rebate concept uses client drug price. These are planning formulas, not Caremark rate schedules.</p>
          </div></Card>
          <Card><CardHeader title="Rebates & delivery"/><div className="grid gap-4 p-5 sm:grid-cols-2">
            <NumberField name="rebate" label="Expected rebates · $ PMPM" value={input.rebate}/>
            <NumberField name="guarantee" label="Rebate floor · $ PMPM" value={input.guarantee}/>
            <NumberField name="labor" label="Staff cost · $ PMPM" value={input.labor}/>
            <NumberField name="platform" label="Technology cost · $ PMPM" value={input.platform}/>
            <NumberField name="overhead" label="Overhead · $ PMPM" value={input.overhead}/>
            <p className="text-xs leading-relaxed text-ink-500 sm:col-span-2">Rebates belong to the employer in this concept. Fees are separate. A shortfall against the assumed rebate floor is funded by the PBM. Staff costs are assumptions, not measured automation savings.</p>
          </div></Card>
        </div>
        <fieldset><legend className="mb-3 text-sm font-semibold">Benefit approach</legend><div className="grid gap-4 md:grid-cols-3">{Object.entries(PACKAGES).map(([id,p])=><label key={id} className="cursor-pointer rounded-xl border border-ink-200 bg-white p-5 has-[:checked]:border-glass-600 has-[:checked]:ring-1 has-[:checked]:ring-glass-600"><div className="flex items-center justify-between"><span className="font-semibold">{p.name}</span><input type="radio" name="benefits" value={id} defaultChecked={input.benefits===id} className="accent-emerald-700"/></div><p className="mt-2 text-sm text-ink-500">{p.summary}</p><p className="mt-4 text-xs text-ink-600">{p.memberShareBps/100}% aggregate member share</p></label>)}</div><p className="mt-3 text-xs text-ink-500">Illustrative cost-sharing options. No formulary, network or utilization change is assumed. Individual member disruption requires claim-level analysis.</p></fieldset>
        <div className="flex flex-wrap items-center gap-4"><button className={button} type="submit">Update estimate <ArrowRight size={16}/></button><Link href="/offering" className="text-sm text-ink-500 underline">Reset assumptions</Link><p className="text-xs text-ink-500">Your scenario is saved in the page URL. Benefits are not activated.</p></div>
      </form>
    </>}
    {view==='sponsor' && <div className="grid gap-4 md:grid-cols-3">
      <NextCard title="Member impact" text="Compare employer and member costs before choosing a benefit approach." href={link('/offering')} label="Compare benefits"/>
      <NextCard title="Service performance" text="No service history for this concept yet. Explore member service on the reference book." href="/assistant" label="Try member service"/>
      <NextCard title="Find savings" text="Compare savings, disrupted members, and estimated NPS on the reference claims." href="/savings" label="Compare options"/>
    </div>}
    {view==='business' && <Card><CardHeader title="Work and ownership" description="Existing reference workflows · No Caremark systems connected"/><div className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-4">{[
      ['Quote','Account team','Compare approved commercial options. This prototype uses illustrative assumptions.','/offering'],
      ['Implement','Benefits operations','Validate enrollment and review configuration before activation.','/eligibility'],
      ['Serve','Member services','Ground answers in benefit rules and route clinical decisions for review.','/assistant'],
      ['Renew','Account team','Review trend drivers and test benefit changes before recommending them.','/trends'],
    ].map(([title,owner,body,href])=><div key={title}><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs text-glass-700">{owner}</p><p className="mt-3 text-sm leading-relaxed text-ink-500">{body}</p><Link href={href==='/offering'?link(href):href} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-ink-900">Open workflow <ArrowUpRight size={14}/></Link></div>)}</div><div className="border-t border-ink-100 p-5"><Link href="/agents" className="text-sm font-medium text-glass-800">View recorded agent work →</Link><p className="mt-2 text-xs text-ink-500">Implementation time and service commitments are not measured for this offering. No profitability claim includes unmodeled affiliate revenue, acquisition costs, taxes or capital.</p></div></Card>}
    <details className="rounded-xl border border-ink-200 bg-white text-sm"><summary className="cursor-pointer p-5 font-medium">Assumptions & sources</summary><div className="space-y-3 border-t border-ink-100 p-5 text-ink-600"><p>All figures above are annualized synthetic planning estimates for a constant enrolled population. They are independent of the Wisconsin/Navitus reference claims. This concept is not an announced Caremark product, an approved quote, or a live integration.</p><p>Benefit packages change aggregate cost sharing only. Gross utilization is held constant. Rebates are estimated entitlements, not receipts or settled employer credits. Monthly/quarterly settlement timing is not simulated here.</p><p>The model allows an employer credit when projected rebates exceed costs; it does not withhold that value or cap employer entitlement at zero. No budget benchmark is claimed: the displayed budget is an editable planning assumption.</p><p>Concept source: <a className="underline" href="https://business.caremark.com/what-we-do/transparency/truecost.html" target="_blank" rel="noreferrer">Caremark TrueCost</a>. Drug-level rebate options: <a className="underline" href="https://business.caremark.com/insights/2025/unmasking-true-costs.html" target="_blank" rel="noreferrer">Caremark pricing explanation</a>. Neither source supplies the executable rates in this demo.</p><p>Version: {OFFERING_VERSION}. <Link className="underline" href="/sponsor/reference">Inspect the separate reference book</Link>.</p></div></details>
  </div>;
}
function NumberField({name,label,value,min=0,max=10000,step='0.01'}:{name:string;label:string;value:number;min?:number;max?:number;step?:string}) {
  return <label className="text-sm text-ink-700">{label}<input className={field} type="number" name={name} defaultValue={value} min={min} max={max} step={step} required/></label>;
}
function NextCard({title,text,href,label}:{title:string;text:string;href:string;label:string}) {
  return <Card><div className="p-5"><h2 className="text-sm font-semibold">{title}</h2><p className="mt-2 text-sm leading-relaxed text-ink-500">{text}</p><Link href={href} className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-glass-800">{label}<ArrowUpRight size={14}/></Link></div></Card>;
}
