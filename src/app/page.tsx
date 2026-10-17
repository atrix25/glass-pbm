import { LandingStudio } from '@/components/landing-studio';
import { LandingLedger } from '@/components/landing-ledger';
import Link from 'next/link';
import { ArrowDown, ArrowRight, Check, Diamond, Layers3, ShieldCheck, Sparkles } from 'lucide-react';
import { ROLES } from '@/lib/roles';
import { signIn } from '@/app/actions/session';

const action = 'inline-flex items-center justify-center gap-3 rounded-full bg-blue-700 px-6 py-3.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700';
const textLink = 'inline-flex items-center gap-2 rounded text-sm font-medium text-blue-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4';
const preview = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_12px_48px_-24px_rgba(30,64,175,0.22)] sm:p-7';

export default function Home() {
  return <main className="min-h-dvh bg-[#fafbfe] text-slate-900 selection:bg-blue-100">
    <a href="#platform" className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:bg-white focus:p-4">Skip to platform</a>
    <div className="mx-auto max-w-6xl px-6 sm:px-10">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200/70 py-7">
        <Link href="/" aria-label="Sapphire home" className="flex items-center gap-2.5 text-2xl font-semibold tracking-[-.06em]"><Diamond className="text-blue-700" size={24} strokeWidth={1.8}/>sapphire<span className="text-blue-700">.</span></Link>
        <nav aria-label="Main navigation" className="flex items-center gap-6 text-sm"><a href="#platform" className="hidden text-slate-600 hover:text-blue-700 sm:block">The platform</a><a href="#demo-access" className="font-medium text-slate-700 hover:text-blue-700">Explore by role <span aria-hidden="true">↗</span></a></nav>
      </header>
      <section className="mx-auto max-w-4xl py-20 text-center sm:py-28">
        <h1 className="text-5xl font-medium leading-[1.06] tracking-[-.055em] sm:text-7xl">Your plan.<br/><span className="text-blue-700">Built around your people.</span></h1>
        <p className="mx-auto mt-7 max-w-lg text-lg leading-relaxed text-slate-600">Design a better pharmacy benefit. Know where the money goes. Keep finding ways to improve.</p>
        <div className="mt-9 flex flex-wrap justify-center gap-4"><Link prefetch={false} href="/benefit-changes" className={action}>Build your plan <ArrowRight size={16}/></Link><a href="#platform" className="inline-flex items-center gap-3 rounded-full border border-slate-200 bg-white px-6 py-3.5 text-sm font-medium hover:border-blue-400">Explore the platform <ArrowDown size={16}/></a></div>
      </section>
      <nav aria-label="Platform sections" className="grid grid-cols-3 border-y border-slate-200 py-5 text-center text-xs sm:text-sm">
        {['Design','Administer','Improve'].map((label,i)=><a key={label} href={['#studio','#assurance','#autopilot'][i]} className="rounded px-2 py-1 text-slate-600 hover:text-blue-700"><span className="mr-2 text-blue-700">0{i+1}</span>{label}</a>)}
      </nav>
      <p className="mt-5 text-center text-sm text-slate-500">One plan. From design to daily decisions.</p>
      <div id="platform" className="scroll-mt-8">
        <section id="studio" aria-labelledby="studio-title" className="grid scroll-mt-8 items-center gap-10 border-b border-slate-200 py-16 lg:grid-cols-[.9fr_1.1fr] lg:gap-20 sm:py-20">
          <div><Layers3 size={26} className="text-blue-700" strokeWidth={1.5}/><p className="mt-6 text-xs font-medium uppercase tracking-widest text-slate-500">01 / Design</p><h2 id="studio-title" className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Benefit Design Studio</h2><p className="mt-5 max-w-sm text-lg leading-relaxed text-slate-600">Compare options. Understand the tradeoffs. Build your plan.</p><p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-500">Compare coverage, pharmacy and clinical-program options together.</p><Link prefetch={false} href="/benefit-changes" className={textLink+' mt-7'}>Open the studio <ArrowRight size={16}/></Link></div>
          <LandingStudio/>
        </section>
        <section id="assurance" aria-labelledby="assurance-title" className="grid scroll-mt-8 items-center gap-10 border-b border-slate-200 py-16 lg:grid-cols-[.9fr_1.1fr] lg:gap-20 sm:py-20">
          <div>
            <ShieldCheck size={26} className="text-blue-700" strokeWidth={1.5}/>
            <p className="mt-6 text-xs font-medium uppercase tracking-widest text-slate-500">02 / Administer</p>
            <h2 id="assurance-title" className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Administer with assurance</h2>
            <p className="mt-5 max-w-sm text-lg leading-relaxed text-slate-600">See the amount. Open the detail.</p>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-500">A simple ledger connects each prescription to its charges, member payment and employer credits. Click a row to follow the calculation.</p>
            <div className="mt-7 flex flex-col items-start gap-4">
              <Link prefetch={false} href="/settlement" className={textLink}>Follow the money <ArrowRight size={16}/></Link>
              <Link prefetch={false} href="/reconciliation" className="rounded text-sm text-slate-600 underline underline-offset-4">Check your guarantees</Link>
            </div>
          </div>
          <LandingLedger/>
        </section>
        <section id="autopilot" aria-labelledby="autopilot-title" className="grid scroll-mt-8 items-center gap-10 py-16 lg:grid-cols-[.9fr_1.1fr] lg:gap-20 sm:py-20">
          <div><Sparkles size={26} className="text-blue-700" strokeWidth={1.5}/><p className="mt-6 text-xs font-medium uppercase tracking-widest text-slate-500">03 / Improve</p><h2 id="autopilot-title" className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Autopilot</h2><p className="mt-5 max-w-sm text-lg leading-relaxed text-slate-600">Keep costs in check. Keep your people in mind.</p><p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-500">Sapphire watches spending and changing drug options, recommends savings with fewer member disruptions, and tracks results after approved changes.</p><div className="mt-7 flex flex-col items-start gap-4"><Link prefetch={false} href="/gemma" className={textLink}>See Sapphire at work <ArrowRight size={16}/></Link><Link prefetch={false} href="/savings" className="rounded text-sm text-slate-600 underline underline-offset-4">Explore savings</Link></div></div>
          <div className={preview}><PreviewLabel title="A plan that keeps improving" label="Simulated workflow preview"/><ol className="mt-6 space-y-3">{[['New drug options','Assess generics and biosimilars.'],['Better dispensing options','Compare available pharmacy and channel costs.'],['Changing spending patterns','Reassess benefit and clinical-program choices.']].map(([title,body],i)=><li key={title} className="flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3"><span className="mt-0.5 text-xs font-medium text-blue-700">0{i+1}</span><div><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 text-xs text-slate-500">{body}</p></div></li>)}</ol><p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-slate-500"><Check size={14} className="mt-0.5 shrink-0"/>Compare the impact. Approve the change. Track the result.</p></div>
        </section>
      </div>
      <section id="demo-access" className="scroll-mt-8 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"><div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-medium">Explore by role</h2><p className="text-xs text-slate-500">Choose a starting point in the demonstration.</p></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{ROLES.map(role=><form key={role.id} action={signIn}><input type="hidden" name="role" value={role.id}/><button type="submit" className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-4 text-left text-sm font-medium transition hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-700">{role.label}<ArrowRight size={15} className="text-blue-700"/></button></form>)}</div></section>
      <footer className="mt-12 flex flex-col justify-between gap-5 border-t border-slate-200 py-8 sm:flex-row"><span className="text-sm font-semibold tracking-tight">sapphire.</span><p className="max-w-2xl text-xs leading-relaxed text-slate-500">Concept demonstration, not an announced Caremark product. Workflows use a synthetic reference book; external actions are simulated. No Caremark systems are connected. <Link prefetch={false} href="/sources" className="underline underline-offset-2">Sources</Link></p></footer>
    </div>
  </main>;
}

function PreviewLabel({title,label}:{title:string;label:string}) {
  return <div className="border-b border-slate-100 pb-4"><p className="mb-3 text-[11px] text-slate-500">Steel Potatoes · Example employer</p><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{title}</h3><span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</span></div></div>;
}
