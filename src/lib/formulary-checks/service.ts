import {randomUUID} from 'node:crypto';
import {prisma} from '@/lib/db';
import {tenantSponsorId} from '@/lib/config';
import {assertAvailable,assertIntegrity,createState,digest,recordReview,visibleState,type State} from './core';
const scope=(sponsor:string)=>({tenantId:tenantSponsorId(),sponsorId:sponsor});
export async function createRun(sponsor:string,cutoff:Date,key:string){
 assertAvailable(sponsor,cutoff);const state=createState();
 const r=await prisma.assuranceRun.upsert({where:{key:digest(['formulary',tenantSponsorId(),sponsor,key])},update:{},create:{id:`frm_${randomUUID()}`,key:digest(['formulary',tenantSponsorId(),sponsor,key]),...scope(sponsor),cutoff,state:JSON.stringify(state),inputHash:state.inputHash,sealedAnswer:'{}',commitment:state.outputHash}});return r.id;
}
export async function readRun(sponsor:string,cutoff:Date,id?:string){
 assertAvailable(sponsor,cutoff);
 if(id&&!id.startsWith('frm_'))return null;
 const row=await prisma.assuranceRun.findFirst({where:{...scope(sponsor),id:id??{startsWith:'frm_'},createdAt:{lte:cutoff}},orderBy:{createdAt:'desc'}});
 if(!row)return null;const state=JSON.parse(row.state) as State;assertIntegrity(state);const visible=visibleState(state,cutoff);
 return visible?{id:row.id,revision:row.revision,state:visible}:null;
}
export type Review={id:string;revision:number;key:string;rowId:string;verdict:'Correct'|'Needs correction';note:string};
export async function reviewRun(sponsor:string,cutoff:Date,c:Review,actor:string){
 assertAvailable(sponsor,cutoff);
 await prisma.$transaction(async tx=>{
 const row=await tx.assuranceRun.findFirst({where:{id:c.id,...scope(sponsor)}});if(!row||!c.id.startsWith('frm_'))throw Error('Run unavailable');
 const s=JSON.parse(row.state) as State;assertIntegrity(s);
 if(cutoff.getTime()<Date.now()-60000)throw Error('Return to the current clock to review');
 if(s.commands[c.key]){if(s.commands[c.key]!==digest(c))throw Error('Conflicting retry');return;}
 if(row.revision!==c.revision)throw Error('Stale revision; refresh');
 recordReview(s,c.rowId,c.verdict,c.note,actor);s.commands[c.key]=digest(c);
 const updated=await tx.assuranceRun.updateMany({where:{id:row.id,...scope(sponsor),revision:row.revision},data:{state:JSON.stringify(s),revision:row.revision+1}});if(!updated.count)throw Error('Stale revision; refresh');
 });
}
export type Run=NonNullable<Awaited<ReturnType<typeof readRun>>>;
