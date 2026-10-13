import {prisma} from '@/lib/db';
import type {Access} from '@/lib/service/identity';
import {ServiceError} from '@/lib/service/identity';
import type {SavingsResult} from '@/lib/savings/types';
import type {Proposal} from './types';
export async function importSavings(a:Access,run:string,option:string){
 const job=await prisma.job.findUnique({where:{id:run}});if(!job||job.type!=='savings-v1'||job.status!=='succeeded'||!job.result)throw new ServiceError('Saved recommendation not found.',404);
 const payload=JSON.parse(job.payload);if(payload.sponsor!==a.sponsorId||payload.contract!==a.contractId)throw new ServiceError('Recommendation not found in this employer.',404);
 const result=JSON.parse(job.result) as SavingsResult;if(new Date(result.completedAt)>a.at||new Date(result.cutoff)>a.at)throw new ServiceError('Recommendation is unavailable at this cutoff.',404);
 const found=result.options.find(o=>o.id===option);if(!found)throw new ServiceError('Recommendation not found.',404);
 const o=found.override,keys=Object.keys(o);const p:Proposal={kind:'blocked',copayCents:300,drugId:'',requiresPA:false,specialtyRestricted:false,effectiveDate:new Date().toISOString().slice(0,10),request:found.description};
 let message='This recommendation contains changes outside the supported workflow. It remains a proposal; use the existing Change console to inspect it.';
 if(keys.length===1&&o.costShare?.length===1&&o.costShare[0].level==='1'&&(!o.costShare[0].channel||o.costShare[0].channel==='Retail')&&o.costShare[0].copayCents!==undefined&&Object.keys(o.costShare[0]).every(k=>['level','channel','copayCents','costShareType'].includes(k))){p.kind='copay';p.copayCents=o.costShare[0].copayCents;message='Review the imported copay proposal, then run a new full-book analysis.';}
 if(keys.length===1&&o.specialtyChannelRestricted!==undefined){p.kind='specialty';p.specialtyRestricted=o.specialtyChannelRestricted;message='Review the imported specialty access proposal.';}
 if(keys.length===1&&o.formulary?.length===1&&o.formulary[0].requiresPA!==undefined&&Object.keys(o.formulary[0]).every(k=>['drugId','nameContains','requiresPA'].includes(k))){const f=o.formulary[0];const drugs=await prisma.drug.findMany({where:f.drugId?{id:f.drugId}:{name:{contains:f.nameContains??'',mode:'insensitive'}},take:2});if(drugs.length===1){p.kind='pa';p.drugId=drugs[0].id;p.requiresPA=f.requiresPA!;message='Review the exact drug and authorization proposal.';}else message='This option covers multiple drugs. Select one exact drug in a new proposal; the complete option is not imported.';}
 return {title:found.title,message,proposal:p,override:o,origin:{savings:run,option}};
}
