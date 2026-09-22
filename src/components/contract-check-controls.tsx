"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./rebate-protection.module.css";
export function ContractCheckControls({cutoff,maxDate}:{cutoff:string;maxDate:string}){
 const router=useRouter(),key=useRef<string|null>(null);
 const [date,setDate]=useState(cutoff.slice(0,10)),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function run(){setBusy(true);setError("");key.current??=crypto.randomUUID();try{
 const r=await fetch("/api/contract-checks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:key.current,cutoff:`${date}T00:00:00.000Z`})});
 const data=await r.json();if(!r.ok)throw Error(data.error);key.current=null;router.push(`/contract-checks?run=${data.id}`);router.refresh();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className={styles.controls}><form onSubmit={e=>{e.preventDefault();void run();}}><label>Evidence cutoff<input aria-label="Evidence cutoff" type="date" required max={maxDate} value={date} onChange={e=>{setDate(e.target.value);key.current=null;}} className="rounded-lg border border-ink-200 p-2 text-sm"/></label><p className="flex-1 text-xs text-ink-500">Checks run on load. Save a run to retain its inputs and findings.</p><button disabled={busy} type="submit">{busy?"Checking…":"Run checks & save"}</button></form>{error&&<p role="alert" className={styles.error}>{error}</p>}</div>;
}
