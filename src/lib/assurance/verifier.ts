import type {Answer,State,Score,Values} from './types';
export const VERIFIER_VERSION='assurance-verifier-1';
// Separate, deliberately small comparator; never invokes detector/repair/engine.
const same=(a:Values,b:Values)=>Object.keys(b).every(k=>a[k]===b[k]);
export function verify(state:State,answer:Answer):Score{
 let detected=0,missed=0,falseAlarms=0,exactAmounts=0,verifiedRepairs=0,unresolved=0,regressions=0,cleanControls=0,unverified=0;
 const details=answer.expectations.map(e=>{
  const initial=state.initial.find(f=>f.recordId===e.recordId),current=state.findings.find(f=>f.recordId===e.recordId),record=state.book.records.find(r=>r.id===e.recordId),patch=state.patches.find(p=>p.recordId===e.recordId);
  let detection='Clean control',resolution='Unchanged';
  if(e.state==='Exception'){
   if(initial?.state==='Exception'){detected++;detection='Detected';if(e.amountCents!==null&&initial.amountCents===e.amountCents)exactAmounts++;}else{missed++;detection=initial?.state==='Not verified'?'Blocked at initial check':'Missed';}
   const corrected=e.repairable&&record&&e.target&&same(record.actual,e.target)&&current?.state==='Clear'&&patch?.state==='Verified';
   if(corrected){verifiedRepairs++;resolution='Independently verified';}else{unresolved++;resolution=e.repairable?'Unresolved':'Recorded breach; cannot undo';}
  }else if(e.state==='Clear'){
   cleanControls++;if(initial?.state==='Exception'){falseAlarms++;detection='False alarm';}
   if(!record||!e.target||!same(record.actual,e.target)||current?.state!=='Clear'){regressions++;resolution='Regression';}
  }else{unverified++;detection=initial?.state==='Not verified'?'Unknown correctly exposed':'Unknown not exposed';if(current?.state==='Clear'){regressions++;resolution='False assurance';}else resolution='Not verified';}
  return {id:e.recordId,detection,resolution};
 });
 return {detected,missed,falseAlarms,exactAmounts,verifiedRepairs,unresolved,regressions,cleanControls,unverified,details};
}
