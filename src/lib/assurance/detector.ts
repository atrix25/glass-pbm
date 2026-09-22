import type {Book,Finding,Specimen,Values} from './types';
import {engineResult} from './engine';
export const DETECTOR_VERSION='assurance-detector-1';
export function equal(a:Values,b:Values){return JSON.stringify(Object.entries(a).sort())===JSON.stringify(Object.entries(b).sort());}
export function detect(book:Book):Finding[]{
 const visible=book.records.filter(r=>r.recordedAt<=book.cutoff&&r.serviceAt<=book.cutoff);
 const result:Finding[]=[];
 const walk=(r:Specimen)=>{
  const terms=r.requirements.filter(t=>t.recordedAt<=book.cutoff&&t.from<=r.serviceAt&&t.to>=r.serviceAt&&t.population===r.population&&t.approved);
  const clauses=terms.map(t=>`${t.id} v${t.version} · ${t.clause}`);
  const base:Finding={id:r.id,recordId:r.id,area:r.area,control:r.control,label:r.label,state:'Clear',reason:'No exception in this evaluated record.',expected:null,actual:r.actual,amountCents:null,review:r.review,external:r.external,permanent:false,clause:clauses};
  if(!book.sourceManifest||!book.sourceManifest.includes(r.id)||terms.length!==1){result.push({...base,state:'Not verified',reason:!book.sourceManifest?'Independent source manifest missing.':terms.length!==1?'Missing, conflicting or inapplicable effective contract terms.':'Record absent from source manifest.'});return;}
  if(r.dependencies.some(id=>!visible.some(x=>x.id===id)||result.some(x=>x.recordId===id&&x.state!=='Clear'))){result.push({...base,state:'Not verified',reason:'An upstream configuration or transaction is unresolved.'});return;}
  const term=terms[0];let expected:Values={...term.values};
  if(r.kind==='engine'){try{expected=engineResult(r,book);}catch{result.push({...base,state:'Not verified',reason:'Adjudication could not evaluate this context.'});return;}}
  if(r.kind==='guarantee'){const obligation=Number(term.values.rateCents)*Number(r.basis.units);expected={rateCents:Number(term.values.rateCents),forecastCents:obligation,clientObligationCents:obligation,expectedTopupCents:Math.max(0,obligation-Number(r.basis.manufacturerCents))};}
  if(r.kind==='collection'){if(String(term.values.dueAt)>book.cutoff){result.push({...base,state:'Not due',reason:'Manufacturer receipt is within contractual terms; no leakage classified.'});return;}expected={receivedCents:Number(term.values.amountCents),disputedCents:0};}
  if(r.kind==='invoice'){
   const eligible=term.values.eligible===true&&!r.basis.reversed;
   const upstream=r.dependencies.map(id=>visible.find(x=>x.id===id)!).filter(Boolean);
   const claimTotal=upstream.length?upstream.reduce((s,x)=>s+Number(x.actual.planCents??0),0):Number(r.basis.units)*Number(term.values.rateCents);
   const amount=eligible?claimTotal+Number(term.values.feeCents??0)-Number(term.values.creditCents??0)+Number(term.values.adjustmentCents??0):0;
   expected={amountCents:amount,period:String(term.values.period),lineCount:amount===0?0:1};
  }
  if(r.kind==='rate'){
   if(term.values.authorized!==true){result.push({...base,state:'Not verified',reason:'Adjustment authority is missing or ambiguous; contract interpretation required.'});return;}
   const due=String(term.values.eventAt)<=book.cutoff&&Number(term.values.performance)>=Number(term.values.threshold)&&term.values.noticeSatisfied===true;
   expected={rateBps:due?Math.min(Number(term.values.capBps),Number(term.values.baseBps)+Number(term.values.adjustmentBps)):Number(term.values.baseBps)};
  }
  if(r.kind==='notice'){
   if(String(term.values.triggerAt)>book.cutoff){result.push({...base,state:'Not due',reason:'Trigger has not occurred.'});return;}
   expected={recipient:String(term.values.recipient),delivered:true,deliveredAt:book.cutoff};
   const late=String(term.values.deadline)<book.cutoff&&(!r.actual.delivered||String(r.actual.deliveredAt)>String(term.values.deadline));
   if(late){result.push({...base,expected,state:'Exception',reason:'Contractual notice deadline missed. A later notice cannot undo the breach.',permanent:true});return;}
   const okay=r.actual.delivered===true&&r.actual.recipient===expected.recipient&&String(r.actual.deliveredAt)>=String(term.values.triggerAt)&&String(r.actual.deliveredAt)<=book.cutoff;
   result.push({...base,expected,state:okay?'Clear':'Exception',reason:okay?'Simulated delivery evidence meets the notice obligation.':'Notice requires correct recipient and recorded simulated delivery evidence.'});return;
  }
  const mismatch=!equal(r.actual,expected);
  const moneyKey=['amountCents','billedCents','rateCents','copayCents','receivedCents','memberCents','planCents'].find(k=>typeof expected[k]==='number'&&typeof r.actual[k]==='number'&&expected[k]!==r.actual[k]);
  result.push({...base,expected,state:mismatch?'Exception':'Clear',amountCents:mismatch&&moneyKey?Math.abs(Number(expected[moneyKey])-Number(r.actual[moneyKey])):null,reason:mismatch?'Recorded implementation differs from the effective obligation.':'Matches the effective requirement for this record.'});
 };
 // A deterministic topological order; cycles remain explicit rather than silently skipped.
 const pending=[...visible];while(pending.length){const i=pending.findIndex(r=>r.dependencies.every(d=>!pending.some(p=>p.id===d)));if(i<0){for(const r of pending)result.push({id:r.id,recordId:r.id,area:r.area,control:r.control,label:r.label,state:'Not verified',reason:'Cyclic dependencies.',expected:null,actual:r.actual,amountCents:null,review:true,external:r.external,permanent:false,clause:[]});break;}walk(pending.splice(i,1)[0]);}
 if(book.sourceManifest)for(const id of book.sourceManifest)if(!book.records.some(r=>r.id===id))result.push({id,recordId:id,area:0,control:'source-completeness',label:'Source completeness',state:'Not verified',reason:'Manifest record is absent; recover the source before calculating exposure.',expected:null,actual:{},amountCents:null,review:true,external:false,permanent:false,clause:[]});
 return result;
}
