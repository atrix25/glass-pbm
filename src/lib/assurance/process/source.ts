import {STAGES,emptyStep,type Area,type ProcessState,type Source} from './types';
import type {Values} from '../types';
const values:Record<Area,Values>={
 contract:{network:'Preferred',outOfNetworkCovered:false,copayCents:500,paRequired:false,stepRequired:false,quantityLimit:90,clientEligible:true,manufacturerEligible:true},
 drugs:{classification:'Brand',limitedDistribution:false,formularyTier:'1',covered:true,retail90Eligible:true,minimumDays:84,maximumDays:90,maintenanceChoice:false,retailFillsAllowed:2},
 claims:{dispensingFeeCents:100,oopLimitCents:60000},
 rates:{authorized:true,eventAt:'2026-04-01',baseFeeCents:100,adjustmentCents:20,capCents:110,performance:95,threshold:90,noticeSatisfied:true},
 manufacturer:{unitRebateCents:10,period:'2026Q2',dueAt:'2026-05-01',receiptCents:300},
 guarantees:{rateCents:400,population:'Commercial',effectiveFrom:'2026-04-01'},
 client:{feeCents:50,period:'2026-04',passThroughBps:10000},
 notices:{triggerAt:'2026-04-01',deadline:'2026-05-02',recipient:'Benefits lead',approvedRestatement:true},
};
export function newProcess(sponsor:string,scenario:'clean'|'errors'|'missing'|'conflicts'='clean'):ProcessState{
 const terms=Object.fromEntries(STAGES.map(s=>[s.id,[{id:`process-${s.id}`,version:1,clause:`Synthetic ${s.name.toLowerCase()} exhibit`,from:'2026-01-01',to:'2026-12-31',recordedAt:'2026-01-01',population:'Commercial',approved:true,values:structuredClone(values[s.id])}]])) as Source['terms'];
 // Verbatim public excerpt, deliberately limited to the principle it actually supports.
 // Financial rates and the synthetic book below are NOT represented as Wisconsin contract terms.
 if(sponsor==='wisconsin')terms.guarantees[0].source={kind:'contract',text:'Qualifying Brand Claims = Total Brand Claims – exclusions under this Agreement.',document:'ETG0013 Amendment 7 · Amendment 7A',location:'Page 3 · qualifying-claim definition; guarantee rates remain synthetic',url:'https://etf.wi.gov/sites/default/files/2024-07/Amendment%20%237%20ETG0013.pdf#page=3',recordedAt:'2026-01-01'};
 const claims=[{id:'rx-1',member:'member-1',serviceAt:'2026-04-15',recordedAt:'2026-04-15',quantity:30,days:30,ingredientCents:1000,reversed:false,manufacturerEligible:true,guaranteeEligible:true},{id:'rx-2',member:'member-2',serviceAt:'2026-04-16',recordedAt:'2026-04-16',quantity:30,days:30,ingredientCents:1000,reversed:true,manufacturerEligible:true,guaranteeEligible:true}];
 const source:Source={terms,claims,manifest:claims.map(c=>c.id),cutoff:'2026-05-01T00:00:00.000Z',period:'2026-04'};
 if(scenario==='missing')for(const s of STAGES)source.terms[s.id]=[];
 if(scenario==='conflicts')for(const s of STAGES)source.terms[s.id].push({...structuredClone(source.terms[s.id][0]),id:`conflict-${s.id}`});
 const overrides=scenario==='errors'?{contract:{copayCents:900},drugs:{classification:'Generic'},rates:{feeCents:150},claims:{netPlanCents:999},manufacturer:{entitledCents:900},guarantees:{topupCents:0},client:{rebateCreditCents:0},notices:{recipient:'Wrong recipient'}}:{};
 return {format:2,sponsor,agentId:'rebate-protection',versions:{processor:'process-1',verifier:'process-verifier-1'},baseline:structuredClone(source),source,overrides,steps:Object.fromEntries(STAGES.map(s=>[s.id,emptyStep()])) as ProcessState['steps'],events:[],commands:{},tests:null};
}
