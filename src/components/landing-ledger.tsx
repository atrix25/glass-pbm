import { Plus } from 'lucide-react';

// Public, synthetic display fixtures only. These are not contract prices or operational records.
const entries = [
  { id: 'DEMO-101', drug: 'Metformin', supply: '30-day supply', charge: 2400, member: 1000, credit: 0, fee: 200, pending: 0 },
  { id: 'DEMO-102', drug: 'Atorvastatin', supply: '90-day supply', charge: 3400, member: 1000, credit: 0, fee: 200, pending: 0 },
  { id: 'DEMO-103', drug: 'Adalimumab', supply: '28-day supply', charge: 125000, member: 10000, credit: 25000, fee: 200, pending: 0 },
  { id: 'DEMO-104', drug: 'Semaglutide', supply: '28-day supply', charge: 105000, member: 7500, credit: 0, fee: 200, pending: 30000 },
];
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents === 0 ? 0 : cents / 100);
const net = (e: typeof entries[number]) => e.charge - e.member - e.credit + e.fee;

export function LandingLedger() {
  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_48px_-24px_rgba(30,64,175,0.22)]">
    <div className="px-5 py-5 sm:px-7">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Plan ledger</h3><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-600">Synthetic example</span></div>
      <p className="mt-2 text-xs text-slate-500">Steel Potatoes · 4 example claims</p>
    </div>
    <div className="flex items-center justify-between border-y border-slate-100 bg-slate-50 px-5 py-2.5 text-[11px] text-slate-500 sm:px-7"><span>Prescription</span><span className="mr-9">Net plan cost</span></div>
    <div className="divide-y divide-slate-100">
      {entries.map(e => <details key={e.id} className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 transition hover:bg-blue-50/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-700 sm:px-7 [&::-webkit-details-marker]:hidden">
          <div><span className="text-sm font-medium">{e.drug}</span><span className="mt-1 block text-[11px] text-slate-500">{e.pending ? 'Rebate pending' : e.supply}</span></div>
          <div className="flex shrink-0 items-center gap-4"><span className="tnum text-sm font-semibold">{money(net(e))}</span><span className="rounded-md border border-slate-200 p-1 text-slate-500 group-open:border-blue-200 group-open:bg-blue-50 group-open:text-blue-700"><Plus size={14} className="transition-transform group-open:rotate-45" aria-hidden="true"/></span></div>
        </summary>
        <div className="border-t border-blue-100 bg-blue-50/40 px-5 py-5 sm:px-7">
          <p className="mb-4 text-[11px] text-slate-500">{e.id} · {e.supply} · Illustrative breakdown</p>
          <dl className="space-y-2.5 text-xs text-slate-600">
            {[
              ['Prescription charge',e.charge],
              ['Member payment',-e.member],
              ['Employer credit received',-e.credit],
              ['Administration fee',e.fee],
            ].map(([label,cents]) => <div key={label} className="flex justify-between gap-4"><dt>{label}</dt><dd className="tnum shrink-0">{money(Number(cents))}</dd></div>)}
            <div className="flex justify-between gap-4 border-t border-blue-100 pt-3 font-semibold text-slate-900"><dt>Net plan cost</dt><dd className="tnum">{money(net(e))}</dd></div>
          </dl>
          {e.pending > 0 && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900"><span className="font-medium">{money(e.pending)} expected rebate</span><p className="mt-1">Not yet received or credited. Excluded from the cost reduction above.</p></div>}
          <p className="mt-4 text-[11px] leading-relaxed text-slate-500">Example terms: prescription charge less member payment and received employer credit, plus a $2 fee. Amounts and terms are synthetic.</p>
        </div>
      </details>)}
    </div>
    <div className="flex items-center justify-between gap-4 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-7"><span className="text-xs font-medium text-slate-600">Total net plan cost</span><span className="tnum text-lg font-semibold tracking-tight">{money(entries.reduce((sum,e) => sum + net(e),0))}</span></div>
    <p className="px-5 py-4 text-[11px] leading-relaxed text-slate-500 sm:px-7">Illustrative amounts, not actual claims or Caremark prices. Open any row to see the calculation.</p>
  </div>;
}
