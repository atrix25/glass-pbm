"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SCENARIOS } from "@/lib/rebate-protection/scenarios";
import type { Simulation } from "@/lib/rebate-protection/service";
import styles from "./rebate-protection.module.css";
export function RebateControls({run}:{run?:Simulation|null}) {
  const router=useRouter();const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [scenario,setScenario]=useState(run?.scenarioId??"omitted"),[cadence,setCadence]=useState(run?.snapshot.cadence??"Quarterly");
  const key=useRef<string|null>(null);
  async function send(body:Record<string,unknown>){
    if(busy)return;setBusy(true);setError("");
    try{
      const response=await fetch("/api/rebate-protection",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const data=await response.json();if(!response.ok)throw Error(data.error??"Request failed");
      if(body.action==="create")key.current=null;
      router.push(`/rebate-protection?run=${data.id}`);router.refresh();
    }catch(e){setError(e instanceof Error?e.message:"Request failed");}finally{setBusy(false);}
  }
  return <div className={styles.controls}>
    <form onSubmit={e=>{e.preventDefault();key.current??=crypto.randomUUID();void send({action:"create",scenarioId:scenario,cadence,key:key.current});}}>
      <label>Scenario<select value={scenario} disabled={busy} onChange={e=>{setScenario(e.target.value);key.current=null;}}>{SCENARIOS.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
      <label>Reconciliation<select value={cadence} disabled={busy} onChange={e=>{setCadence(e.target.value as "Monthly"|"Quarterly");key.current=null;}}><option>Quarterly</option><option>Monthly</option></select></label>
      <button className={styles.secondary} type="button" disabled={busy} onClick={()=>router.refresh()}>Refresh</button>
      <button disabled={busy} type="submit">{busy?"Working…":"New simulation"}</button>
    </form>
    {run&&!run.historical&&run.stage>=0&&run.stage<3&&<div className={styles.next}>
      {run.stage===1&&run.snapshot.scenario.review&&!run.decision?<>
        <p><strong>Simulated Finance review</strong><br/>{run.snapshot.scenario.control}</p>
        <button disabled={busy} onClick={()=>void send({action:"review",id:run.id,decision:"Approved"})}>Approve simulation</button>
        <button className={styles.secondary} disabled={busy} onClick={()=>void send({action:"review",id:run.id,decision:"Rejected"})}>Reject simulation</button>
      </>:<><p>{["Inspect the exception and prepare the correction.","Apply the simulated manufacturer response.","Record simulated cash and close reconciliation."][run.stage]}</p><button disabled={busy} onClick={()=>void send({action:"advance",id:run.id,stage:run.currentStage})}>{["Prepare correction","Simulate response","Simulate settlement"][run.stage]}</button></>}
    </div>}
    {run?.historical&&<p>Historical view. Return to the latest checkpoint to continue.</p>}
    {error&&<p role="alert" className={styles.error}>{error}</p>}
  </div>;
}
