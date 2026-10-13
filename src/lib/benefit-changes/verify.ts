// Independent expectations. The adjudicator and configuration mapper never import these assertions.
import {adjudicate} from '@/lib/engine/adjudicate';
import {applyPlanOverride,applyFormularyOverride,type ConfigOverride} from '@/lib/engine/replay';
import {drug,entry,makeContext,PLAN} from './sandbox-inputs';
import type {Proposal,TestResult} from './types';
export function verifyBenefit(p:Proposal,override:ConfigOverride,fault=false):TestResult[]{
 const results:TestResult[]=[];
 function run(name:string,level:string,id:string,requiresPA:boolean,specialty:boolean,cap:boolean,expected:{status:string;member:number;code:string|null}){
  const d=drug({id,name:'Synthetic '+name,isSpecialty:specialty,nadacPerUnit:specialty?10:1});
  const e=entry({level,requiresPA});
  const ctx=makeContext({drug:d,formularyEntry:applyFormularyOverride(e,d.name,id,override),plan:applyPlanOverride(PLAN,override),usualAndCustomaryCents:10000,accumulators:cap?{rxOopAccumulatedCents:59900,federalOopAccumulatedCents:0,deductibleAccumulatedCents:0}:undefined});
  const out=adjudicate(ctx),produced={status:out.responseStatus,member:out.patientPayCents+(fault&&name==='Generic copay'?100:0),code:out.rejectCodes[0]??null};
  results.push({name,expected,produced,passed:JSON.stringify(expected)===JSON.stringify(produced)});
  if(out.responseStatus==='P'){if(!specialty)results.push({name:name+' · exact allowed amount',expected:3690,produced:out.totalBilledCents,passed:out.totalBilledCents===3690});const rx=out.costShare?.accumulatorDeltas.find(x=>x.accumulatorType==='RxOopIndividual');results.push({name:name+' · accumulator',expected:level==='4'?0:expected.member,produced:Math.round((rx?.amountMicros??0)/10000),passed:Math.round((rx?.amountMicros??0)/10000)===(level==='4'?0:expected.member)});results.push({name:name+' · balance',expected:out.totalBilledCents,produced:out.planPaidCents+out.patientPayCents,passed:out.planPaidCents+out.patientPayCents===out.totalBilledCents});}
 }
 const copay=override.costShare?.find(x=>x.level==='1'&&x.channel==='Retail')?.copayCents??500;
 // The proposal, not the generated configuration, supplies the requested expected value.
 const expectedCopay=p.kind==='copay'?p.copayCents:copay;
 run('Generic copay','1','synthetic-generic',false,false,false,{status:'P',member:Math.min(expectedCopay,3690),code:null});
 run('Out-of-pocket boundary','1','synthetic-generic',false,false,true,{status:'P',member:Math.min(expectedCopay,100),code:null});
 const pa=p.kind==='pa'?p.requiresPA:true;
 run('Selected drug authorization','1',p.drugId||'synthetic-pa',true,false,false,{status:pa?'R':'P',member:pa?0:Math.min(expectedCopay,3690),code:pa?'75':null});
 run('Unrelated authorization','1','synthetic-unrelated',true,false,false,{status:'R',member:0,code:'75'});
 const restricted=p.kind==='specialty'?p.specialtyRestricted:(override.specialtyChannelRestricted??true);
 run('Specialty channel','4','synthetic-specialty',false,true,false,{status:restricted?'R':'P',member:restricted?0:5000,code:restricted?'70':null});
 return results;
}
