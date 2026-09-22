import {randomUUID} from 'node:crypto';
import {detect,equal} from './detector';
import type {State,AuditEvent} from './types';
export const REPAIR_VERSION='assurance-repair-1';
export function event(state:State,kind:string,recordId:string|null,detail:string,actor='Operational leakage protection',extra:Partial<AuditEvent>={}){state.events.push({id:randomUUID(),at:new Date().toISOString(),effectiveAt:state.book.cutoff,kind,recordId,actor,detail,...extra});}
/** Only contract-derived findings enter repair. No injected answer or fixture imports. */
export function prepareAndRepair(state:State){
 if(!state.detected){state.initial=detect(state.book);state.detected=true;event(state,'Detected',null,'Checks executed on frozen supplied evidence.');}
 for(let pass=0;pass<=state.book.records.length;pass++){
  const findings=detect(state.book);let changed=false;
  for(const f of findings){
   if(f.state!=='Exception'||!f.expected||f.permanent||state.patches.some(p=>p.recordId===f.recordId))continue;
   const r=state.book.records.find(r=>r.id===f.recordId)!;
   const p={id:`patch-${r.id}`,recordId:r.id,before:structuredClone(r.actual),after:structuredClone(f.expected),dependencies:[...r.dependencies],review:f.review||f.external,state:(f.review||f.external?'Awaiting review':'Prepared') as 'Awaiting review'|'Prepared',reason:f.reason};state.patches.push(p);
   event(state,'Prepared',r.id,'Prepared a correction from the effective requirement.',undefined,{before:p.before,after:p.after});
   if(p.review)event(state,'Awaiting review',r.id,'Simulated human approval required.');else {apply(state,p.id,'Automatic safe repair');changed=true;}
  }
  if(!changed)break;
 }
 state.findings=detect(state.book);
 for(const p of state.patches)if(p.state==='Applied'||p.state==='Verified'||p.state==='Failed verification'){
  const clear=state.findings.find(f=>f.recordId===p.recordId)?.state==='Clear';
  const next=clear?'Verified':'Failed verification';if(p.state!==next){p.state=next;event(state,next,p.recordId,clear?'Retest passed after the working record changed. Independent proof is reported separately.':'Retest failed; the issue remains unresolved.');}
 }
}
export function apply(state:State,id:string,actor:string){
 const p=state.patches.find(p=>p.id===id);if(!p)throw Error('Correction unavailable');
 if(['Applied','Verified','Failed verification'].includes(p.state))return;
 if(p.state==='Rejected')throw Error('Correction rejected');
 const r=state.book.records.find(r=>r.id===p.recordId);if(!r||!equal(r.actual,p.before))throw Error('Stale correction');
 const current=detect(state.book).find(f=>f.recordId===p.recordId);
 if(current?.state!=='Exception'||!current.expected||!equal(current.expected,p.after))throw Error('Stale correction');
 r.actual=structuredClone(p.after);p.state='Applied';event(state,'Applied',r.id,'Updated isolated working record; no operational change.',actor,{before:p.before,after:p.after});
}
export function review(state:State,id:string,decision:'Approved'|'Rejected',actor:string){
 const p=state.patches.find(p=>p.id===id);if(!p)throw Error('Correction unavailable');
 const previous=state.events.find(e=>e.kind==='Simulated review'&&e.recordId===p.recordId);
 if(previous){if(previous.detail!==decision)throw Error('Conflicting decision');return;}
 if(p.state!=='Awaiting review')throw Error('No review pending');
 event(state,'Simulated review',p.recordId,decision,actor);
 if(decision==='Rejected')p.state='Rejected';else{
  const r=state.book.records.find(r=>r.id===p.recordId)!;
  // Approval alone cannot create manufacturer acceptance, delivery, or cash settlement.
  if(r.external){r.actual={...r.actual,draftPrepared:true};p.before=structuredClone(r.actual);event(state,'Draft prepared',r.id,'Approved draft; external evidence remains pending.',actor);}
  else apply(state,id,actor);
 }
 prepareAndRepair(state);
}
export function externalEvidence(state:State,id:string,actor:string){
 const p=state.patches.find(p=>p.id===id),r=state.book.records.find(r=>r.id===p?.recordId);
 if(!p||!r?.external||!state.events.some(e=>e.recordId===r.id&&e.kind==='Simulated review'&&e.detail==='Approved'))throw Error('Approved draft required');
 if(p.state==='Verified')return;
 const current=detect(state.book).find(f=>f.recordId===r.id);if(current?.permanent)throw Error('Expired obligation cannot be repaired');
 // Remove the draft marker before guarded comparison, which uses the frozen before payload.
 r.actual={...p.before};apply(state,id,actor);event(state,'Simulated external evidence',r.id,r.kind==='notice'?'Simulated delivery receipt recorded.':r.kind==='collection'?'Simulated receipt settled in the isolated book. Employer allocation remains a separate obligation.':'Simulated manufacturer acceptance recorded. Collection remains unrecorded; no recovery recognized.',actor);prepareAndRepair(state);
}
