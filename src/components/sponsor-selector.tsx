"use client";
import { useState } from "react";
import { PROFILES, type SponsorKey } from "@/lib/contract-checks/profiles";
export function SponsorSelector({selected}:{selected:SponsorKey}){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 async function change(sponsor:string){setBusy(true);setError("");try{
  const r=await fetch("/api/demo-sponsor",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sponsor})});
  if(!r.ok)throw Error("Unable to switch sponsors.");
  window.location.assign("/rebate-protection");
 }catch(e){setError((e as Error).message);setBusy(false);}}
 return <div className="mx-auto mt-5 flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-3 px-4">
  <label className="flex items-center gap-3 text-xs text-ink-500">Plan sponsor<select aria-label="Plan sponsor" value={selected} disabled={busy} onChange={e=>void change(e.target.value)} className="rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-900">{Object.entries(PROFILES).map(([id,p])=><option key={id} value={id}>{p.name}</option>)}</select></label>
  <span className="text-xs text-ink-500">{PROFILES[selected].subtitle}</span>{error&&<p role="alert">{error}</p>}
 </div>;
}
