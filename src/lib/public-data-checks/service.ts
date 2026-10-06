import {randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {prisma} from '@/lib/db';
import {tenantSponsorId} from '@/lib/config';
import {dataset,digest,manifest,assertCutoff} from './data';
import {compare,buildDraft,buildPriceLookups} from './processor';
import {verify,verifyPrices,verifyPriceLookups} from './verifier';
import type {State} from './types';
const encode=(state:State)=>JSON.stringify({encoding:'gzip-v1',data:gzipSync(JSON.stringify(state),{level:1}).toString('base64')});
const decode=(raw:string):State=>{const stored=JSON.parse(raw);return stored.encoding==='gzip-v1'?JSON.parse(gunzipSync(Buffer.from(stored.data,'base64')).toString()):stored;};
const scope=(sponsor:string)=>({tenantId:tenantSponsorId(),sponsorId:sponsor});
export async function createRun(sponsor:string,cutoff:Date,key:string){
 assertCutoff(cutoff);const data=dataset(),at=new Date().toISOString();
 const state:State={version:1,engine:'public-config-1',verifier:'source-agreement-1',inputHash:manifest.payloadHash,createdAt:at,stage:'Compared',changes:compare(data.snapshots['2026-08'],data.snapshots['2026-09']),draft:null,priceLookups:[],checks:[],events:[{at,action:'Compared published snapshots'}],commands:{}};
 const uniqueKey=digest(['public-data',tenantSponsorId(),sponsor,key]);
 let row;try{row=await prisma.assuranceRun.upsert({where:{key:uniqueKey},update:{},create:{id:`pub_${randomUUID()}`,key:digest(['public-data',tenantSponsorId(),sponsor,key]),...scope(sponsor),cutoff,state:encode(state),inputHash:state.inputHash,sealedAnswer:'{}',commitment:digest(state)}});}catch(e){if((e as {code?:string}).code!=='P2002')throw e;row=await prisma.assuranceRun.findUnique({where:{key:uniqueKey}});if(!row)throw e;}return row.id;
}
export async function readRun(sponsor:string,cutoff:Date,id?:string){
 assertCutoff(cutoff);if(id&&!id.startsWith('pub_'))return null;
 const row=await prisma.assuranceRun.findFirst({where:{...scope(sponsor),id:id??{startsWith:'pub_'},createdAt:{lte:cutoff}},orderBy:{createdAt:'desc'}});if(!row)return null;
 const state=decode(row.state);
 if(state.inputHash!==manifest.payloadHash||digest(state)!==row.commitment)throw Error('Run version unavailable');
 // Do not expose a later mutation through a historical clock.
 if(state.events.some(e=>new Date(e.at)>cutoff))throw Error('Run updated after this cutoff');
 return {id:row.id,revision:row.revision,state};
}
export async function advance(sponsor:string,c:{id:string;key:string;revision:number;action:'build'|'verify'}){
 await prisma.$transaction(async tx=>{
 const row=await tx.assuranceRun.findFirst({where:{id:c.id,...scope(sponsor)}});if(!row||!c.id.startsWith('pub_'))throw Error('Run unavailable');
 const state=decode(row.state);
 if(state.inputHash!==manifest.payloadHash||digest(state)!==row.commitment)throw Error('Run version unavailable');
 if(state.commands[c.key]){if(state.commands[c.key]!==digest(c))throw Error('Conflicting retry');return;}
 if(row.revision!==c.revision)throw Error('Stale revision; refresh');
 const data=dataset();
 if(c.action==='build'){
  if(state.stage!=='Compared')throw Error('Step already completed');
  state.draft=buildDraft(data.snapshots['2026-08'],data.snapshots['2026-09'],state.changes);state.priceLookups=buildPriceLookups(data.prices);state.stage='Draft built';
 }else{
  if(!state.draft)throw Error('Build the draft first');
  state.checks=[...verify(data,state.draft,manifest.census['2026-09']),...verifyPrices(data),verifyPriceLookups(data,state.priceLookups)];
  state.stage='Verified';
 }
 state.events.push({at:new Date().toISOString(),action:c.action==='build'?'Built isolated draft from recorded changes':'Verified draft against original source records'});state.commands[c.key]=digest(c);
 const result=await tx.assuranceRun.updateMany({where:{id:row.id,...scope(sponsor),revision:row.revision},data:{state:encode(state),commitment:digest(state),revision:row.revision+1}});if(!result.count)throw Error('Stale revision; refresh');
 },{timeout:30000,maxWait:10000});
}
