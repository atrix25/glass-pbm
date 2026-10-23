'use client';

import { useState } from 'react';

// Authored scenario assumptions for the public preview, not outputs from the claims engine.
const scenarios = [
  { name: 'Best member experience', savings: '−$29,758', oop: '$31,700', members: '0', nps: 'Not modeled', description: 'Prioritize member experience with fewer cost and access changes.' },
  { name: 'Balanced', savings: '$0', oop: '$61,458', members: '0', nps: 'Not modeled', description: 'Balance savings with member cost and access changes.' },
  { name: 'Higher savings', savings: '$44,404', oop: '$105,862', members: '137', nps: 'Not modeled', description: 'Consider broader changes with greater member impact.' },
];

export function LandingStudio() {
  const [selected, setSelected] = useState(1);
  const scenario = scenarios[selected];
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_12px_48px_-24px_rgba(30,64,175,0.22)] sm:p-7">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">Willow Works · Example employer</p><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-600">Illustrative scenarios</span></div>
    <h3 className="mt-4 text-xl font-semibold tracking-tight">Try the tradeoff</h3>
    <div className="mt-7 flex items-center justify-between gap-3"><label htmlFor="studio-goal" className="text-sm font-medium">Savings goal</label><span className="text-sm font-semibold text-blue-700">{scenario.name}</span></div>
    <input id="studio-goal" type="range" min={0} max={2} step={1} value={selected} onChange={e=>setSelected(Number(e.target.value))} aria-valuetext={scenario.name} aria-describedby="studio-assumptions" className="mt-4 h-8 w-full cursor-pointer accent-blue-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700"/>
    <div className="mt-1 flex justify-between gap-4 text-xs text-slate-500"><span>Best member experience</span><span>Higher savings</span></div>
    <p className="mt-4 min-h-10 text-xs leading-relaxed text-slate-500">{scenario.description}</p>
    <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200" aria-live="polite" aria-atomic="true">
      {[
        [scenario.savings,'Annual employer claim savings'],
        [scenario.oop,'Total annual employee out-of-pocket cost'],
        [scenario.members,'Unique members disrupted by higher cost or access changes'],
        [scenario.nps,'Experience impact'],
      ].map(([value,label],i)=><div key={label} className={'p-4 sm:p-5 '+(i%2===0?'border-r border-slate-200 ':'')+(i<2?'border-b border-slate-200':'')}><p className="tnum text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{value}</p><p className="mt-2 text-xs leading-relaxed text-slate-500">{label}</p></div>)}
    </div>
    <p id="studio-assumptions" className="mt-5 text-[11px] leading-relaxed text-slate-500">Illustrative 250-member, 2,404-fill annual scenario. Compared with the Balanced design, before rebates. These savings shift cost to employees; no lower drug prices are assumed. Customize the plans in the Studio.</p>
  </div>;
}
