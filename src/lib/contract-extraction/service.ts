import {randomUUID} from 'node:crypto';
import {prisma} from '@/lib/db';
import {tenantSponsorId} from '@/lib/config';
import {initial,hash,freeze,citation,type State,type Verdict} from './core';
import {extract,available} from './extract';
const scope=(sponsor:string)=>({tenantId:tenantSponsorId(),sponsorId:sponsor});
export async function createExtraction(sponsor:string,key:string){
 if(!available())throw Error('Model connection required');const state=initial();
 const row=await prisma.assuranceRun.upsert({where:{key:hash(['extraction',tenantSponsorId(),sponsor,key])},update:{},create:{id:`ext_${randomUUID()}`,key:hash(['extraction',tenantSponsorId(),sponsor,key]),...scope(sponsor),cutoff:new Date('2019-12-31'),state:JSON.stringify(state),inputHash:hash(state.source),sealedAnswer:'{}',commitment:'manual-review-1'}});return row.id;
}
export async function executeExtraction(id:string,sponsor:string){
 const row=await prisma.assuranceRun.findFirst({where:{id,...scope(sponsor)}});if(!row||!id.startsWith('ext_'))return;
 const state=JSON.parse(row.state) as State;if(state.status!=='Queued')return;
 if(hash(state.source)!==row.inputHash)return;
 state.status='Running';state.startedAt=new Date().toISOString();state.attempt++;
 const claim=await prisma.assuranceRun.updateMany({where:{id,revision:row.revision,...scope(sponsor)},data:{state:JSON.stringify(state),revision:row.revision+1}});if(!claim.count)return;
 try{const result=await extract(state.source);state.raw=result.value;state.original=freeze(result.value,state.source);state.originalHash=hash(state.original);state.execution='model';state.model=result.model;state.usage=result.usage;state.limitations=result.value.limitations;state.status='Complete';state.error=null;}
 catch(error){console.error('Contract extraction failed',{name:error instanceof Error?error.name:'Unknown'});state.status='Failed';state.error='Model extraction did not complete. No scripted answer was substituted.';}
 state.finishedAt=new Date().toISOString();
 await prisma.assuranceRun.updateMany({where:{id,revision:row.revision+1,...scope(sponsor)},data:{state:JSON.stringify(state),revision:row.revision+2}});
}
export async function readExtraction(id:string,sponsor:string){if(!id.startsWith('ext_'))return null;const row=await prisma.assuranceRun.findFirst({where:{id,...scope(sponsor)}});return row?{id:row.id,revision:row.revision,createdAt:row.createdAt.toISOString(),readAt:Date.now(),state:JSON.parse(row.state) as State}:null;}
export async function recentExtractions(sponsor:string){return prisma.assuranceRun.findMany({where:{...scope(sponsor),id:{startsWith:'ext_'}},select:{id:true,createdAt:true},orderBy:{createdAt:'desc'},take:6});}
export type ReviewCommand={id:string;revision:number;key:string;action:'review'|'omission'|'page'|'retry';requirementId?:string;verdict?:Verdict;correction?:string;note?:string;page?:number;quote?:string;interpretation?:string};
export function applyReview(state:State,c:ReviewCommand,actor:string){
 const at=new Date().toISOString();
 if(c.action==='retry'){
  if(state.status!=='Failed'&&!(state.status==='Running'&&Date.now()-Date.parse(state.startedAt!)>300000))throw Error('Extraction is not retryable');
  state.status='Queued';state.error=null;return;
 }
 if(state.status!=='Complete'||state.execution!=='model')throw Error('Model extraction is not complete');
 if(hash(state.original)!==state.originalHash)throw Error('Original extraction integrity check failed');
 if(c.action==='review'){
  const r=state.original.find(r=>r.id===c.requirementId);if(!r)throw Error('Requirement unavailable');
  if(c.verdict==='Correct'&&!r.citations.every(x=>x.matched))throw Error('A correct answer requires matching source quotations');
  if(c.verdict==='Corrected'&&!c.correction?.trim())throw Error('Enter the corrected interpretation');
  state.reviews.push({id:randomUUID(),requirementId:r.id,verdict:c.verdict!,correction:c.correction??'',note:c.note??'',actor,at});
 }else if(c.action==='omission'){
  if(!c.page||!c.quote||!citation(state.source,c.page,c.quote).matched)throw Error('Omission must quote a supplied source page');
  state.omissions.push({id:randomUUID(),page:c.page,quote:c.quote,interpretation:c.interpretation!,actor,at});
  state.pageReviews=state.pageReviews.filter(r=>r.page!==c.page);
 }else{
  if(!state.source.pages.some(p=>p.page===c.page))throw Error('Page unavailable');
  if(!state.pageReviews.some(r=>r.page===c.page))state.pageReviews.push({page:c.page!,actor,at});
 }
}
export async function reviewExtraction(sponsor:string,c:ReviewCommand,actor:string){
 await prisma.$transaction(async tx=>{
 const row=await tx.assuranceRun.findFirst({where:{id:c.id,...scope(sponsor)}});if(!row||!c.id.startsWith('ext_'))throw Error('Run unavailable');const state=JSON.parse(row.state) as State;
 if(hash(state.source)!==row.inputHash)throw Error('Source integrity check failed');
 if(state.commands[c.key]){if(state.commands[c.key]!==hash(c))throw Error('Conflicting retry');return;}
 if(row.revision!==c.revision)throw Error('Stale revision; refresh this run');
 applyReview(state,c,actor);state.commands[c.key]=hash(c);
 const result=await tx.assuranceRun.updateMany({where:{id:c.id,revision:row.revision,...scope(sponsor)},data:{state:JSON.stringify(state),revision:row.revision+1}});if(!result.count)throw Error('Stale revision; refresh this run');
 });
}
