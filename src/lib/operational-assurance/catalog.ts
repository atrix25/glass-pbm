import type {Requirement,State} from '../contract-extraction/core';
import {drugRequirements} from '../contract-extraction/areas';
export const ASSURANCE_AREAS = [
 {id:'contract',name:'Contract implementation',authority:['Executed agreement','Approved configuration'],requirement:'Approved terms are reflected in network, benefit, clinical and financial configuration.',actual:'Effective configuration, approval records and amendment history',check:'Compare each approved provision to its effective configuration and affected population.',role:'Contract administration',next:'Provide the approved configuration and applicable contract amendments.'},
 {id:'drugs',name:'Drug definitions',authority:['Contract definitions','Dated drug reference files','Approved formulary'],requirement:'Drug classifications and guarantee inclusions follow the applicable definitions and dated reference sources.',actual:'Drug reference files, specialty lists, formulary versions and configured attributes',check:'Compare brand/generic, specialty, limited distribution, formulary and channel attributes independently.',role:'Benefits operations',next:'Provide the dated drug reference files, approved lists and configured drug attributes.'},
 {id:'claims',name:'Claim adjudication',authority:['Benefit policy','Eligibility records','Pricing rules','Clinical criteria'],requirement:'Claims follow effective coverage, eligibility, pricing, clinical and cost-sharing rules.',actual:'Actual claims, eligibility, pricing, accumulator movements and adjudication traces',check:'Compare claim results to independently established outcomes, including reversals and accumulators.',role:'Claims operations',next:'Provide actual claim results and the effective eligibility, benefit, clinical and pricing rules.'},
 {id:'guarantees',name:'Rebate guarantee changes',authority:['Executed agreement','Approved amendments'],requirement:'Guarantee calculations reflect approved amendments at the correct dates and for the correct populations.',actual:'Guarantee calculations, approved amendments, eligible claims and settlement records',check:'Recalculate affected obligations and compare original and amended positions without reducing employer entitlements.',role:'Rebate operations · Finance',next:'Provide approved amendments, eligible utilization and actual guarantee calculations.'},
 {id:'rates',name:'Rate adjustments',authority:['Contractual adjustment rights','Regulatory source','Event evidence'],requirement:'Rate changes have documented authority and meet applicable triggers, caps, dates and notice requirements.',actual:'Dated rate versions, regulatory or performance events, approvals and notices',check:'Check required and unsupported adjustments against governing authority and recorded event evidence.',role:'Finance · Contract administration',next:'Provide the governing adjustment provision, event evidence and approved rate versions.'},
 {id:'client',name:'Client invoicing',authority:['Client agreement','Approved accounting control','Transaction records'],requirement:'Charges and credits reconcile to claims, agreed fees, rebates, guarantees and prior adjustments.',actual:'Client invoice lines, adjudicated claims, credits, reversals and control totals',check:'Reconcile source totals and line items; identify omissions, duplicates, incorrect amounts and wrong periods.',role:'Client billing · Finance',next:'Provide actual client invoices and the underlying transactions and independent control totals.'},
 {id:'manufacturer',name:'Manufacturer invoicing',authority:['Manufacturer agreement','Submission specifications','Receipts'],requirement:'Manufacturer submissions and collections reflect eligible utilization and manufacturer-specific terms.',actual:'Manufacturer terms, eligible claims, submission lines, responses and allocated receipts',check:'Reconcile eligible claims through submission, acceptance and receipt; distinguish outstanding amounts from confirmed losses.',role:'Rebate operations',next:'Provide manufacturer agreements, actual submissions, responses and allocated receipts.'},
 {id:'notices',name:'Nonstandard obligations',authority:['Contract clauses','Trigger events','Delivery evidence'],requirement:'Special obligations are completed for the right recipients, within deadlines and with evidence.',actual:'Trigger events, required recipients, deadlines, approvals and completion evidence',check:'Compare each triggered obligation to recorded completion; a prepared notice does not establish delivery.',role:'Contract administration',next:'Provide triggering events and timestamped evidence of delivery or other required completion.'},
] as const;
export type AssuranceArea = typeof ASSURANCE_AREAS[number];
export function relatedRequirements(area:string,requirements:Requirement[]){
 if(area==='drugs')return drugRequirements(requirements);
 // Client rebate clauses are not manufacturer agreements or regulatory authority.
 if(area==='manufacturer')return [];
 return requirements.filter(r=>{
  if(area==='contract')return ['Network','Formulary','Prior authorization','Step therapy'].includes(r.area);
  if(area==='claims')return ['Prior authorization','Step therapy','Formulary'].includes(r.area);
  if(area==='guarantees')return r.area==='Guarantee eligibility';
  if(area==='notices')return r.area==='Notices';
  if(area==='rates')return /rate|discount/i.test(r.title)&&/adjust|modif|revis/i.test(r.title+' '+r.interpretation);
  if(area==='client')return /invoice|pass.through|fee|credit/i.test(r.title);
  return false;
 });
}
export function visibleExtraction(state:State,sponsor:string,cutoff:Date){
 return sponsor==='wisconsin'&&state.source.id==='wisconsin-etg0013-amendment-1'&&state.status==='Complete'&&state.execution==='model'&&!!state.finishedAt&&new Date(state.finishedAt)<=cutoff;
}
// No real implementation feed is connected to this workspace. Missing data never passes.
export function assurancePosition(){return {recordsChecked:0,areasVerified:0,areasMissingEvidence:ASSURANCE_AREAS.length,discrepancies:null,status:'Unable to verify' as const};}
