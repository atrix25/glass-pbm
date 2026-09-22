"use client";

import { useState, useSyncExternalStore } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCents } from "@/lib/money";

type Point = { month: string; pmpmCents: number | null; complete: boolean };
function subscribeBudget(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
export function SponsorCostChart({ data, currentPmpmCents, budgetKey }: { data: Point[]; currentPmpmCents: number | null; budgetKey: string }) {
  const savedBudget = useSyncExternalStore(subscribeBudget, () => {
    try { return window.localStorage.getItem(`glass:sponsor-budget:${budgetKey}`) ?? ""; } catch { return ""; }
  }, () => "");
  const [draft, setBudget] = useState<string | null>(null);
  const budget = draft ?? savedBudget;
  const [editing, setEditing] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const dollars = Number(budget);
  const budgetCents = budget.trim() && Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null;
  function save() { try { if (budgetCents !== null) window.localStorage.setItem(`glass:sponsor-budget:${budgetKey}`, budget); else window.localStorage.removeItem(`glass:sponsor-budget:${budgetKey}`); setStorageError(false); } catch { setStorageError(true); } setEditing(false); }
  const pointData = data.map(d => ({ ...d, label: `${d.month}${d.complete ? "" : " · partial"}` }));
  return <div>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="text-ink-500" aria-live="polite">{budgetCents !== null && currentPmpmCents !== null ? `${formatCents(Math.abs(budgetCents-currentPmpmCents))} ${currentPmpmCents <= budgetCents ? "below" : "above"} budget PMPM` : "No budget entered"}</span>
      <button className="text-emerald-800 underline decoration-emerald-800/30 underline-offset-4" onClick={() => setEditing(!editing)} aria-expanded={editing}>{budgetCents === null ? "Add budget" : "Edit budget"}</button>
    </div>
    {editing && <form className="mb-4 flex flex-wrap items-end gap-3 rounded-md bg-ink-50 p-3" onSubmit={e => { e.preventDefault(); save(); }}><label className="text-xs text-ink-600">Budget PMPM ($)<input aria-label="Budget PMPM in dollars" type="number" min="0.01" step="0.01" value={budget} onChange={e=>setBudget(e.target.value)} className="mt-1 block w-36 rounded border border-ink-200 bg-white px-2 py-1.5 text-sm" /></label><button className="rounded bg-ink-900 px-3 py-2 text-xs text-white">Save</button><button type="button" className="px-2 py-2 text-xs" onClick={()=>{setBudget("");try{localStorage.removeItem(`glass:sponsor-budget:${budgetKey}`);}catch{setStorageError(true);}setEditing(false);}}>Clear</button></form>}
    {storageError && <p role="status" className="mb-2 text-xs text-amber-800">Budget is available for this visit only.</p>}
    {data.some(d=>d.pmpmCents !== null) ? <div role="img" aria-label="Monthly net plan cost per member per month. Current month may be partial."><ResponsiveContainer width="100%" height={230}><LineChart data={pointData} margin={{ top: 15, right: 12, left: 0, bottom: 8 }}><CartesianGrid vertical={false} stroke="#e9eeef"/><XAxis dataKey="label" tick={{fontSize:11,fill:"#74838a"}} axisLine={false} tickLine={false} minTickGap={20}/><YAxis width={60} tick={{fontSize:11,fill:"#74838a"}} axisLine={false} tickLine={false} tickFormatter={v=>`$${Math.round(Number(v)/100)}`}/><Tooltip formatter={v=>[formatCents(Number(v)),"Net PMPM"]} contentStyle={{border:"1px solid #e1e7ea",borderRadius:6,fontSize:12}}/>{budgetCents!==null&&<ReferenceLine y={budgetCents} ifOverflow="extendDomain" stroke="#7e8b90" strokeDasharray="3 4"/>}<Line type="linear" dataKey="pmpmCents" stroke="#28735c" strokeWidth={2.25} dot={{r:3,fill:"#fff",strokeWidth:1.5}} connectNulls={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div> : <p className="py-16 text-center text-sm text-ink-500">No eligible coverage in this period.</p>}
    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-ink-500"><span><span className="mr-1.5 inline-block w-4 border-t-2 border-emerald-800 align-middle"/>Accrued net cost</span>{budgetCents!==null&&<span><span className="mr-1.5 inline-block w-4 border-t border-dashed border-ink-500 align-middle"/>Employer budget</span>}<span>Fees included · Rebates estimated</span></div>
    {budgetCents!==null&&<p className="mt-2 text-[11px] text-ink-400">Budget saved in this browser.</p>}
    <details className="mt-3 text-[11px] text-ink-500"><summary className="cursor-pointer">Monthly values</summary><dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">{pointData.map(d=><div key={d.month} className="flex justify-between gap-2"><dt>{d.label}</dt><dd>{d.pmpmCents===null?"—":formatCents(d.pmpmCents)}</dd></div>)}</dl></details>
  </div>;
}
