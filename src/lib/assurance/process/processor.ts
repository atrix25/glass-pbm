import {adjudicate} from '@/lib/engine/adjudicate';
import {engineContext} from '../engine';
import {STAGES,type Area,type Artifact,type Check,type ProcessState,type Stage} from './types';
import type {Book,Specimen} from '../types';
const same=(a:unknown,b:unknown):boolean=>{
 if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();return JSON.stringify(ak)===JSON.stringify(bk)&&ak.every(k=>same((a as Artifact)[k],(b as Artifact)[k]));
};
export function terms(state:ProcessState,id:Area){return state.source.terms[id].filter(t=>t.approved&&t.recordedAt<=state.source.cutoff&&t.from<=state.source.cutoff.slice(0,10)&&t.to>=state.source.cutoff.slice(0,10)&&t.population==='Commercial');}
function check(name:string,expected:unknown,produced:unknown,detail=''):Check{return {name,status:same(expected,produced)?'Passed':'Failed',expected,produced,detail};}
export function inputs(state:ProcessState,stage:Stage):Artifact{return {terms:terms(state,stage.id),sourceClaims:stage.id==='claims'?state.source.claims.filter(c=>c.serviceAt<=state.source.cutoff&&c.recordedAt<=state.source.cutoff):undefined,sourceManifest:stage.id==='claims'?state.source.manifest:undefined,upstream:Object.fromEntries(stage.dependencies.map(id=>[id,{version:state.steps[id].version,output:state.steps[id].output}]))};}
export function build(state:ProcessState,id:Area):Artifact{
 const t=terms(state,id)[0].values;
 const output=(key:Area)=>state.steps[key].output!;
 if(id==='contract'||id==='drugs')return {...t};
 if(id==='rates'){
  const due=String(t.eventAt)<=state.source.cutoff&&Number(t.performance)>=Number(t.threshold)&&t.noticeSatisfied===true;
  return {feeCents:due?Math.min(Number(t.capCents),Number(t.baseFeeCents)+Number(t.adjustmentCents)):Number(t.baseFeeCents),effectiveFrom:due?String(t.eventAt):'2026-01-01'};
 }
 if(id==='claims'){
  const config=output('contract'),drug=output('drugs'),rates=output('rates');
  const rows=state.source.claims.filter(c=>c.serviceAt<=state.source.cutoff&&c.recordedAt<=state.source.cutoff).map(c=>{
   const r={id:c.id,claimId:c.id,memberId:c.member,serviceAt:c.serviceAt,basis:{variant:'pricing'},dependencies:[]} as unknown as Specimen;
   const ctx=engineContext(r,{records:[]} as unknown as Book);
   ctx.request.quantityDispensed=c.quantity;ctx.request.daysSupply=c.days;ctx.request.ingredientCostSubmittedCents=c.ingredientCents;
   ctx.plan.costShareRules[0].copayCents=Number(config.copayCents);ctx.plan.rxOopLimitIndividual=Number(t.oopLimitCents);
   ctx.formularyEntry!.requiresPA=config.paRequired===true;ctx.formularyEntry!.requiresStep=config.stepRequired===true;ctx.formularyEntry!.notCovered=drug.covered!==true;ctx.formularyEntry!.level=String(drug.formularyTier);
   ctx.formularyEntry!.hasQuantityLimit=true;ctx.formularyEntry!.qlQuantity=Number(config.quantityLimit);ctx.formularyEntry!.qlDays=30;
   ctx.drug!.isBrandLabel=drug.classification==='Brand';ctx.drug!.monyCode=drug.classification==='Brand'?'M':'Y';
   ctx.pharmacy!.inNetwork=config.network==='Preferred';ctx.contract.rates[0].dispensingFeeCents=Number(rates.feeCents);
   const result=adjudicate(ctx),paid=result.responseStatus==='P';
   const original={billedCents:result.totalBilledCents,memberCents:result.patientPayCents,planCents:result.planPaidCents};
   const reversal=c.reversed&&paid?Object.fromEntries(Object.entries(original).map(([k,v])=>[k,-v])):null;
   const movements=(result.costShare?.accumulatorDeltas??[]).map(d=>({type:d.accumulatorType,micros:d.amountMicros}));
   return {id:c.id,member:c.member,status:paid?(c.reversed?'Reversed':'Paid'):'Rejected',original,reversal,netBilledCents:original.billedCents+Number(reversal?.billedCents??0),netMemberCents:original.memberCents+Number(reversal?.memberCents??0),netPlanCents:original.planCents+Number(reversal?.planCents??0),accumulatorMovements:movements,reversalMovements:c.reversed&&paid?movements.map(m=>({...m,micros:-m.micros})):[],quantity:c.quantity,classification:drug.classification,guaranteeEligible:c.guaranteeEligible&&config.clientEligible===true,manufacturerEligible:c.manufacturerEligible&&config.manufacturerEligible===true,trace:result.trace};
  });
  return {rows,evaluated:rows.length,netPlanCents:rows.reduce((s,r)=>s+r.netPlanCents,0),netMemberCents:rows.reduce((s,r)=>s+r.netMemberCents,0)};
 }
 const rows=()=>output('claims').rows as Artifact[];
 if(id==='manufacturer'){
  const lines=rows().filter(r=>r.status==='Paid'&&r.manufacturerEligible).map(r=>({claimId:r.id,units:r.quantity,amountCents:Number(r.quantity)*Number(t.unitRebateCents)}));
  const entitledCents=lines.reduce((s,r)=>s+r.amountCents,0),receivedCents=state.steps[id].external.settlement?Number(t.receiptCents):0;
  return {lines,period:t.period,entitledCents,accepted:!!state.steps[id].external.acceptance,receivedCents,uncollectedCents:entitledCents-receivedCents,dueAt:t.dueAt};
 }
 if(id==='guarantees'){
  const qualifying=rows().filter(r=>r.status==='Paid'&&r.classification==='Brand'&&r.guaranteeEligible),obligationCents=qualifying.length*Number(t.rateCents),receipts=Number(output('manufacturer').receivedCents);
  return {qualifyingClaims:qualifying.map(r=>r.id),rateCents:t.rateCents,obligationCents,forecastCents:obligationCents,manufacturerReceiptsCents:receipts,topupCents:Math.max(0,obligationCents-receipts),employerEntitlementCents:Math.max(receipts,obligationCents),effectiveFrom:t.effectiveFrom};
 }
 if(id==='client'){
  const g=output('guarantees'),manufacturer=output('manufacturer'),claimChargesCents=Number(output('claims').netPlanCents),feeCents=Number(t.feeCents),rebateCreditCents=Number(manufacturer.receivedCents),guaranteeCreditCents=Number(g.topupCents);
  return {period:t.period,claimChargesCents,feeCents,rebateCreditCents,guaranteeCreditCents,netInvoiceCents:claimChargesCents+feeCents-rebateCreditCents-guaranteeCreditCents,lines:[...rows().map(r=>({reference:r.id,amountCents:r.netPlanCents})),{reference:'disclosed-fee',amountCents:feeCents},{reference:'manufacturer-credit',amountCents:-rebateCreditCents},{reference:'pbm-guarantee-credit',amountCents:-guaranteeCreditCents}]};
 }
 return {recipient:t.recipient,triggerAt:t.triggerAt,deadline:t.deadline,deliveredAt:state.steps.notices.external.delivery??null,prepared:true};
}
export function validate(state:ProcessState,id:Area,produced:Artifact,expected:Artifact):Check[]{
 const t=terms(state,id)[0].values,c=[check('Output matches effective inputs',expected,produced)];
 const money=Object.entries(t).filter(([k])=>k.endsWith('Cents'));c.push(check('Amounts are nonnegative integer cents',true,money.every(([,v])=>Number.isSafeInteger(v)&&Number(v)>=0)));
 if(id==='contract')c.push(check('Supported network',true,['Preferred'].includes(String(t.network))),check('Independent eligibility flags',true,typeof t.clientEligible==='boolean'&&typeof t.manufacturerEligible==='boolean'));
 if(id==='drugs')c.push(check('Independent drug attributes',true,['Brand','Generic'].includes(String(t.classification))&&typeof t.limitedDistribution==='boolean'&&typeof t.retail90Eligible==='boolean'&&typeof t.maintenanceChoice==='boolean'),check('Retail 90 boundaries',true,Number(t.minimumDays)<=Number(t.maximumDays)));
 if(id==='rates')c.push(check('Adjustment authority',true,t.authorized===true),check('Contractual cap',true,Number(produced.feeCents)<=Number(t.capCents)));
 if(id==='claims'){
  const visible=state.source.claims.filter(c=>c.recordedAt<=state.source.cutoff&&c.serviceAt<=state.source.cutoff);
  c.push(check('Independent source totals',state.source.manifest.filter(id=>!state.source.claims.some(c=>c.id===id&&(c.serviceAt>state.source.cutoff||c.recordedAt>state.source.cutoff))).sort(),visible.map(r=>r.id).sort()),check('Unique claims',visible.length,new Set(visible.map(r=>r.id)).size));
  const rows=produced.rows as Artifact[];
  c.push(check('Claim amounts balance',true,rows.every(r=>Number(r.netBilledCents)===Number(r.netMemberCents)+Number(r.netPlanCents))));
 }
 if(id==='manufacturer')c.push(check('Receipt does not exceed entitlement',true,Number(produced.receivedCents)<=Number(produced.entitledCents)),check('Submission period',state.source.period.slice(0,4)+'Q'+Math.ceil(Number(state.source.period.slice(5))/3),t.period));
 if(id==='guarantees')c.push(check('Amendment is effective for all paid claims',true,state.source.claims.filter(c=>!c.reversed).every(c=>c.serviceAt>=String(t.effectiveFrom))),check('Employer entitlement preserved',true,Number(produced.employerEntitlementCents)>=Number(produced.obligationCents)));
 if(id==='client')c.push(check('Full rebate pass-through',10000,t.passThroughBps),check('Invoice service period',state.source.period,t.period),check('Invoice balances',produced.netInvoiceCents,(produced.lines as Artifact[]).reduce((s,r)=>s+Number(r.amountCents),0)));
 if(id==='notices')c.push(check('Approved trigger',true,t.approvedRestatement===true&&String(t.triggerAt)<=state.source.cutoff),check('Delivery deadline',true,produced.deliveredAt?String(produced.deliveredAt)<=String(t.deadline)+'T23:59:59.999Z':state.source.cutoff<=String(t.deadline)+'T23:59:59.999Z'));
 return c;
}
export function execute(state:ProcessState,id:Area){
 const stage=STAGES.find(s=>s.id===id)!,s=state.steps[id];
 if(['Released','Rejected','Awaiting review','Awaiting evidence','Failed','Missing evidence'].includes(s.status))return false;
 if(stage.dependencies.some(d=>state.steps[d].status!=='Released')){s.status='Blocked';return false;}
 const selected=terms(state,id);
 if(selected.length!==1){s.status='Missing evidence';s.checks=[{name:'Effective source requirement',status:'Missing evidence',expected:'One approved effective term',produced:selected.length,detail:'Missing or conflicting terms; no assumption of compliance.'}];s.version++;s.attempts.push({at:new Date().toISOString(),version:s.version,inputs:inputs(state,stage),output:null,checks:structuredClone(s.checks)});state.events.push({at:new Date().toISOString(),step:id,kind:'Missing evidence',actor:'Operational leakage protection · scripted sandbox',detail:'No effective unambiguous requirement; no output released.'});state.tests=null;return true;}
 try{
  const expected=build(state,id),produced={...expected,...state.overrides[id]};
  s.checks=validate(state,id,produced,expected);s.output=produced;s.version++;
  s.attempts.push({at:new Date().toISOString(),version:s.version,inputs:inputs(state,stage),output:structuredClone(produced),checks:structuredClone(s.checks)});
  if(s.checks.some(c=>c.status!=='Passed'))s.status='Failed';
  else if(stage.approval&&!s.approved)s.status='Awaiting review';
  else if(stage.external&&(!s.external[stage.external]||(id==='manufacturer'&&Number(produced.uncollectedCents)!==0)))s.status='Awaiting evidence';
  else s.status='Released';
 }catch{ s.status='Failed';s.checks=[{name:'Processor completed',status:'Failed',expected:'Valid output',produced:null,detail:'Invalid or unsupported input; downstream processing blocked.'}];}
 state.events.push({at:new Date().toISOString(),step:id,kind:s.status,actor:'Operational leakage protection · scripted sandbox',detail:stage.rule});
 state.tests=null;return true;
}
export function run(state:ProcessState,one=false){for(const stage of STAGES){if(execute(state,stage.id)&&one)break;}}
export function decide(state:ProcessState,id:Area,decision:'Approved'|'Rejected',actor:string){
 const s=state.steps[id];if(s.status!=='Awaiting review')throw Error('No review pending');
 s.approved=decision==='Approved';s.status=decision==='Approved'?'Not started':'Rejected';state.events.push({at:new Date().toISOString(),step:id,kind:'Simulated review',actor,detail:decision});state.tests=null;
 if(s.approved)execute(state,id);
}
export function external(state:ProcessState,id:Area,kind:'acceptance'|'settlement'|'delivery',actor:string){
 const s=state.steps[id];if(!s.approved||s.status!=='Awaiting evidence')throw Error('Approved valid draft required');
 if((id==='manufacturer'&&!['acceptance','settlement'].includes(kind))||(id==='notices'&&kind!=='delivery')||!['manufacturer','notices'].includes(id))throw Error('Invalid evidence kind');
 if(kind==='settlement'&&!s.external.acceptance)throw Error('Acceptance required before settlement');
 if(s.external[kind])return;
 s.external[kind]=state.source.cutoff;s.status='Not started';state.events.push({at:new Date().toISOString(),step:id,kind:'Simulated '+kind,actor,detail:'Sandbox evidence only; no external transaction.'});execute(state,id);
}
export function repair(state:ProcessState,id:Area,actor:string){
 if(!state.overrides[id])throw Error('No deterministic repair available');
 delete state.overrides[id];const affected=new Set<Area>([id]);for(let i=0;i<STAGES.length;i++)for(const s of STAGES)if(s.dependencies.some(d=>affected.has(d)))affected.add(s.id);
 for(const key of affected){const step=state.steps[key];step.output=null;step.checks=[];step.approved=false;step.external={};step.status='Not started';}
 state.tests=null;state.events.push({at:new Date().toISOString(),step:id,kind:'Working correction',actor,detail:'Removed unsupported implementation fields. Prior attempts retained; affected outputs and approvals invalidated.'});run(state);
}
