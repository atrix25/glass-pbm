import {prisma} from '@/lib/db';
import {replay,type ConfigOverride} from '@/lib/engine/replay';
import {type Goals,type SavingsOption,type SavingsResult,qualify,rankOptions} from './types';
import {setJobProgress} from '@/lib/jobs';
import type {Channel} from '@/lib/engine/types';
export async function runSavings(payload:{cutoff:string;goals:Goals},jobId?:string):Promise<SavingsResult>{
 const opts={asOf:new Date(payload.cutoff),sampleRate:0.01,nps:true,maxDiffs:0,trackDisruption:true};
 const baseline=await replay({},opts);
 if(!baseline.claimsEvaluated||!baseline.membersEvaluated||!baseline.nps?.before.census.scored)throw Error('No evaluated claims or modeled NPS population at this cutoff.');
 if(baseline.claimsChanged!==0)throw Error('Baseline replay differs from stored claims. Resolve baseline discrepancies before comparing savings.');
 const plan=await prisma.benefitPlan.findUniqueOrThrow({where:{id:'wi-iyc-2026'},include:{costShareRules:{where:{channel:'Retail'}}}});
 const rates=await prisma.contractRate.findMany({where:{contractId:'etg0013',rateSide:'Pharmacy',lineOfBusiness:'Commercial'}});
 const generic=plan.costShareRules.find(r=>r.level==='1')?.copayCents;
 const brand=plan.costShareRules.find(r=>r.level==='2')?.coinsuranceMaxCents;
 if(generic===null||generic===undefined||brand===null||brand===undefined)throw Error('Required baseline cost sharing is unavailable.');
 const pricePatch:ConfigOverride={rateOverrides:rates.filter(r=>r.awpDiscountBps!==null).map(r=>({channel:r.channel as Channel,drugClass:r.drugClass as 'Brand'|'Generic'|'All',awpDiscountBps:Math.min(10000,r.awpDiscountBps!+100)}))};
 const candidates=[
 {id:'pricing',title:'Improve contracted discounts',description:'Test an additional 1 percentage point AWP discount. Hypothetical negotiated terms; requires contracting review. Pharmacy economics also change.',override:pricePatch,patch:{negotiatedRates:pricePatch.rateOverrides}},
 {id:'generic',title:'Adjust generic copays',description:'Increase Retail Level 1 copays by $1. Employer savings may transfer expense to members.',override:{costShare:[{level:'1',channel:'Retail',copayCents:generic+100}]} as ConfigOverride,patch:{level1CopayCents:generic+100}},
 {id:'brand',title:'Adjust preferred-brand limit',description:'Increase the Retail Level 2 per-fill maximum by $5. Member cost increases are shown separately.',override:{costShare:[{level:'2',channel:'Retail',coinsuranceMaxCents:brand+500}]} as ConfigOverride,patch:{level2MaxCents:brand+500}},
 ];
 const baselineNet=baseline.planPaidBeforeCents-baseline.rebateBeforeCents;
 const options:SavingsOption[]=[];
 for(let i=0;i<candidates.length;i++){
  if(jobId)await setJobProgress(jobId,(i+1)/4);
  const c=candidates[i],r=await replay(c.override,opts);
  if(r.claimsEvaluated!==baseline.claimsEvaluated||r.planPaidBeforeCents!==baseline.planPaidBeforeCents||r.rebateBeforeCents!==baseline.rebateBeforeCents||!r.nps)throw Error('Reference population changed during analysis. Run again.');
  const savingsCents=baselineNet-(r.planPaidAfterCents-r.rebateAfterCents);
  const option:SavingsOption={...c,savingsCents,savingsPercent:baselineNet>0?savingsCents/baselineNet*100:0,memberCostDeltaCents:r.memberPaidAfterCents-r.memberPaidBeforeCents,npsBefore:r.nps.before.census.nps,npsAfter:r.nps.after.census.nps,membersEvaluated:r.membersEvaluated??0,disruptions:r.memberDisruptions??[],newRejects:r.newRejects,eligible:false,reasons:[]};
  option.reasons=qualify(option,payload.goals);option.eligible=option.reasons.length===0;options.push(option);
 }
 const ranked=rankOptions(options);
 return {version:'savings-v1',cutoff:payload.cutoff,sampleRate:opts.sampleRate,claimsEvaluated:baseline.claimsEvaluated,membersEvaluated:baseline.membersEvaluated,baselineNetCents:baselineNet,goals:payload.goals,options:ranked,recommendedId:ranked.find(o=>o.eligible)?.id??null,completedAt:new Date().toISOString()};
}
