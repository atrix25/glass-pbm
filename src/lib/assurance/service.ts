import {randomUUID,createHash} from 'node:crypto';
import {prisma} from '@/lib/db';
import {tenantSponsorId} from '@/lib/config';
import {makeFixture,digest} from './fixture';
import {prepareAndRepair,review,externalEvidence,REPAIR_VERSION} from './repair';
import {DETECTOR_VERSION} from './detector';
import {verify,VERIFIER_VERSION} from './verifier';
import type {State,Answer} from './types';
const where=(sponsor:string)=>({tenantId:tenantSponsorId(),sponsorId:sponsor});
export async function createAssurance(sponsor:string,key:string){
 const unique=createHash('sha256').update(`${tenantSponsorId()}:${sponsor}:${key}`).digest('hex');
 const pack=makeFixture(sponsor),state:State={versions:{detector:DETECTOR_VERSION,repair:REPAIR_VERSION,verifier:VERIFIER_VERSION},book:pack.book,baseline:structuredClone(pack.book),initial:[],findings:[],patches:[],events:[],revision:0,detected:false,score:null};
 const row=await prisma.assuranceRun.upsert({where:{key:unique},update:{},create:{id:`oas_${randomUUID()}`,key:unique,...where(sponsor),cutoff:new Date(pack.book.cutoff),state:JSON.stringify(state),sealedAnswer:JSON.stringify(pack.answer),commitment:pack.commitment,inputHash:digest(pack.book)}});return row.id;
}
export async function readAssurance(id:string,sponsor:string,clock:Date){
 if(!id.startsWith("oas_"))return null;
 const row=await prisma.assuranceRun.findFirst({where:{id,...where(sponsor),cutoff:{lte:clock}}});if(!row)return null;
 const state=JSON.parse(row.state) as State;
 return {id:row.id,sponsor,createdAt:row.createdAt.toISOString(),revision:row.revision,commitment:row.commitment,inputHash:row.inputHash,state,versions:state.versions??{detector:"Not recorded",repair:"Not recorded",verifier:"Not recorded"},answer:state.detected?JSON.parse(row.sealedAnswer) as Answer:null};
}
export async function recentAssurance(sponsor:string,clock:Date){return prisma.assuranceRun.findMany({where:{...where(sponsor),id:{startsWith:'oas_'},cutoff:{lte:clock}},select:{id:true,createdAt:true},orderBy:{createdAt:'desc'},take:8});}
export type Command={action:'run'|'review'|'external';id:string;revision:number;patchId?:string;decision?:'Approved'|'Rejected'};
export async function act(sponsor:string,clock:Date,c:Command,actor:string){
 if(!c.id.startsWith("oas_"))throw Error("Run unavailable");
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(74839215)::text`;
  // Answer withheld until the detector and repair outputs are computed.
  const row=await tx.assuranceRun.findFirst({where:{id:c.id,...where(sponsor),cutoff:{lte:clock}},select:{state:true,revision:true,inputHash:true}});if(!row)throw Error('Run unavailable');
  const state=JSON.parse(row.state) as State;
  if(digest(state.baseline)!==row.inputHash)throw Error('Evidence integrity check failed');
  if(c.revision!==row.revision){
   if(c.action==='run'&&state.detected)return;
   const previous=state.events.find(e=>e.recordId===state.patches.find(p=>p.id===c.patchId)?.recordId&&e.kind===(c.action==='review'?'Simulated review':'Simulated external evidence'));
   if(previous&&(c.action!=='review'||previous.detail===c.decision))return;
   throw Error('Stale revision; refresh this run');
  }
  if(c.action==='run')prepareAndRepair(state);
  else if(c.action==='review')review(state,c.patchId!,c.decision!,actor);
  else externalEvidence(state,c.patchId!,actor);
  const sealed=await tx.assuranceRun.findFirst({where:{id:c.id,...where(sponsor)},select:{sealedAnswer:true,commitment:true}});if(!sealed)throw Error('Run unavailable');
  const answer=JSON.parse(sealed.sealedAnswer) as Answer;if(digest(answer)!==sealed.commitment)throw Error('Evidence integrity check failed');
  state.score=verify(state,answer);state.revision=row.revision+1;
  await tx.assuranceRun.update({where:{id:c.id},data:{state:JSON.stringify(state),revision:state.revision}});
 });
}
