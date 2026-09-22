import {randomUUID,createHash} from 'node:crypto';
import {prisma} from '@/lib/db';
import {tenantSponsorId} from '@/lib/config';
import {newProcess} from './source';
import {run,decide,external,repair} from './processor';
import {testFlow} from './tests';
import type {Area,ProcessState} from './types';
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const scope=(sponsor:string)=>({tenantId:tenantSponsorId(),sponsorId:sponsor,id:{startsWith:'prc_'}});
export async function createProcess(sponsor:string,key:string,scenario:Parameters<typeof newProcess>[1]){
 const state=newProcess(sponsor,scenario),unique=digest(['process-2',tenantSponsorId(),sponsor,key]);
 const row=await prisma.assuranceRun.upsert({where:{key:unique},update:{},create:{id:`prc_${randomUUID()}`,key:unique,tenantId:tenantSponsorId(),sponsorId:sponsor,cutoff:new Date(state.source.cutoff),state:JSON.stringify(state),inputHash:digest(state.baseline),sealedAnswer:'{}',commitment:'process-verifier-1'}});return row.id;
}
export async function readProcess(id:string,sponsor:string,clock:Date){
 const row=await prisma.assuranceRun.findFirst({where:{...scope(sponsor),id:id.startsWith('prc_')?id:'invalid',cutoff:{lte:clock}}});if(!row)return null;
 return {id:row.id,revision:row.revision,createdAt:row.createdAt.toISOString(),inputHash:row.inputHash,state:JSON.parse(row.state) as ProcessState};
}
export async function recentProcesses(sponsor:string,clock:Date){return prisma.assuranceRun.findMany({where:{...scope(sponsor),cutoff:{lte:clock}},select:{id:true,createdAt:true},orderBy:{createdAt:'desc'},take:6});}
export type ProcessCommand={id:string;revision:number;key:string;action:'flow'|'next'|'test'|'review'|'external'|'repair';step?:Area;decision?:'Approved'|'Rejected';kind?:'acceptance'|'settlement'|'delivery'};
export async function processCommand(sponsor:string,clock:Date,c:ProcessCommand,actor:string){
 await prisma.$transaction(async tx=>{
  const row=await tx.assuranceRun.findFirst({where:{...scope(sponsor),id:c.id.startsWith('prc_')?c.id:'invalid',cutoff:{lte:clock}}});if(!row)throw Error('Run unavailable');
  const state=JSON.parse(row.state) as ProcessState;
  if(digest(state.baseline)!==row.inputHash)throw Error('Evidence integrity check failed');
  const hash=digest(c);if(state.commands[c.key]){if(state.commands[c.key]!==hash)throw Error('Conflicting retry');return;}
  if(row.revision!==c.revision)throw Error('Stale revision; refresh this run');
  if(c.action==='flow'||c.action==='next')run(state,c.action==='next');
  else if(c.action==='test')testFlow(state);
  else if(c.action==='review')decide(state,c.step!,c.decision!,actor);
  else if(c.action==='external')external(state,c.step!,c.kind!,actor);
  else repair(state,c.step!,actor);
  state.commands[c.key]=hash;
  const updated=await tx.assuranceRun.updateMany({where:{id:row.id,revision:row.revision,tenantId:tenantSponsorId(),sponsorId:sponsor},data:{state:JSON.stringify(state),revision:row.revision+1}});
  if(updated.count!==1)throw Error('Stale revision; refresh this run');
 },{timeout:30000});
}
