'use client';
import { useRef,useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './rebate-protection.module.css';
export function ChallengeControls({id,scored}:{id?:string;scored?:boolean}){
 const router=useRouter(),key=useRef<string|null>(null);
 const [busy,setBusy]=useState(false),[size,setSize]=useState(200),[error,setError]=useState('');
 async function send(body:unknown){if(busy)return;setBusy(true);setError('');try{
  const r=await fetch('/api/leakage-challenges',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error);
  key.current=null;router.push(`/leakage-challenges?run=${data.id}`);router.refresh();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className={styles.controls}><form onSubmit={e=>{e.preventDefault();key.current??=crypto.randomUUID();void send({action:'create',key:key.current,size});}}><label>Synthetic book<select value={size} disabled={busy} onChange={e=>{setSize(Number(e.target.value));key.current=null;}}><option value={200}>200 claims</option><option value={1000}>1,000 claims</option></select></label><p className="flex-1 text-xs text-ink-500">New challenge, new seed. Only sandbox copies are changed.</p><button disabled={busy} type="submit">{busy?'Working…':'Create blind challenge'}</button></form>{id&&!scored&&<div className={styles.next}><p>The answer key is withheld. Run Glass, freeze its findings, then reveal the score.</p><button disabled={busy} onClick={()=>void send({action:'evaluate',id})}>Run detector & score</button></div>}{error&&<p role="alert" className={styles.error}>{error}</p>}</div>;
}
