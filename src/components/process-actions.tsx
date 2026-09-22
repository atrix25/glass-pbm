'use client';
import {useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import type {Area,Step} from '@/lib/assurance/process/types';
export function ProcessActions({id,revision=0,step,state,repairable=false}:{id?:string;revision?:number;step?:Area;state?:Step;repairable?:boolean}){
 const router=useRouter(),pending=useRef<{signature:string;key:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[scenario,setScenario]=useState('clean');
 async function send(action:string,extra:Record<string,string>={}){
  if(busy)return;setBusy(true);setError('');const payload=id?{action,id,revision,...extra}:{action:'create',scenario};const signature=JSON.stringify(payload);
  if(pending.current?.signature!==signature)pending.current={signature,key:crypto.randomUUID()};
  try{const r=await fetch('/api/operational-assurance/process',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,key:pending.current.key})});const data=await r.json();if(!r.ok)throw Error(data.error);pending.current=null;if(!id)router.push(`/rebate-protection?run=${data.id}&tab=process`);router.refresh();}catch(e){setError(e instanceof Error?e.message:'Unable to run');}finally{setBusy(false);}
 }
 const button=(text:string,action:string,extra:Record<string,string>={})=><button disabled={busy} onClick={()=>send(action,extra)} className="rounded-lg border border-ink-200 bg-white px-4 py-2 text-xs font-medium text-ink-800 disabled:opacity-50">{text}</button>;
 return <div className="flex flex-wrap items-center gap-2">{!id?<><select aria-label="Test book" value={scenario} onChange={e=>setScenario(e.target.value)} className="rounded-lg border border-ink-200 p-2 text-xs"><option value="clean">Clean inputs</option><option value="errors">Implementation errors</option><option value="missing">Missing terms</option><option value="conflicts">Conflicting terms</option></select>{button('Create flow','create')}</>:!step?<>{button('Run flow','flow')}{button('Run next step','next')}{button('Run tests','test')}</>:<>{state?.status==='Awaiting review'&&<>{button('Approve sandbox step','review',{step,decision:'Approved'})}{button('Reject','review',{step,decision:'Rejected'})}</>}{state?.status==='Awaiting evidence'&&button(`Record simulated ${step==='notices'?'delivery':state.external.acceptance?'settlement':'acceptance'}`,'external',{step,kind:step==='notices'?'delivery':state.external.acceptance?'settlement':'acceptance'})}{repairable&&button('Repair working data','repair',{step})}</>}{busy&&<span role="status" className="text-xs">Processing…</span>}{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}</div>;
}
