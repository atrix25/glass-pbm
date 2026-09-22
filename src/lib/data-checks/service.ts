import { randomUUID,createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import { tenantSponsorId } from '@/lib/config';
import { resolveClock } from '@/lib/clock';
import { answerDataQuestion,type DataAnswer } from '@/lib/agents/data-agent/agent';
import { CASES,type QuestionCase } from './cases';
import { evaluateAnswer,type Check } from './evaluate';
export type Item={test:QuestionCase;answer:DataAnswer|null;checks:Check[];error:string|null;recordedAt:string};
const scope=()=>({tenantId:tenantSponsorId(),sponsorId:'wisconsin'});
export async function createCheck(key:string,cutoff:Date,custom?:string){
 const unique=createHash('sha256').update(`${tenantSponsorId()}:${key}`).digest('hex');
 const cases=custom?[{id:'custom',category:'Custom question',question:custom,tools:[],review:'No predefined expected answer. Review relevance, evidence, uncertainty and completeness.'}]:CASES;
 const old=await prisma.dataAgentCheck.findUnique({where:{key:unique}});
 if(old){if(old.cases!==JSON.stringify(cases))throw Error('Request conflict');return old.id;}
 const row=await prisma.dataAgentCheck.upsert({where:{key:unique},update:{},create:{id:`daq_${randomUUID()}`,key:unique,...scope(),cutoff,cases:JSON.stringify(cases),items:'[]'}});if(row.cases!==JSON.stringify(cases))throw Error('Request conflict');return row.id;
}
export async function readCheck(id:string,clock:Date){
 const row=await prisma.dataAgentCheck.findFirst({where:{id,...scope(),cutoff:{lte:clock}}});
 if(!row)return null;
 return {...row,cases:JSON.parse(row.cases) as QuestionCase[],items:JSON.parse(row.items) as Item[]};
}
export async function nextQuestion(id:string,index:number,clock:Date){
 const row=await readCheck(id,clock);if(!row)throw Error('Run unavailable');
 if(index<row.items.length)return; // Retry after a lost response returns the saved answer.
 if(index!==row.items.length||index>=row.cases.length)throw Error('Question unavailable');
 const token=randomUUID(),now=new Date();
 const lock=await prisma.dataAgentCheck.updateMany({where:{id,...scope(),items:JSON.stringify(row.items),OR:[{leaseUntil:null},{leaseUntil:{lt:now}}]},data:{lease:token,leaseUntil:new Date(now.getTime()+300000)}});
 if(!lock.count)throw Error('Question running');
 let item:Item;
 try{
  const answer=await answerDataQuestion({question:row.cases[index].question,clock:resolveClock(row.cutoff.toISOString()),persist:false});
  item={test:row.cases[index],answer,checks:evaluateAnswer(row.cases[index],answer),error:null,recordedAt:new Date().toISOString()};
 }catch{
  item={test:row.cases[index],answer:null,checks:[],error:'The data agent could not complete this question. No answer was scored.',recordedAt:new Date().toISOString()};
 }
 await prisma.dataAgentCheck.updateMany({where:{id,lease:token},data:{items:JSON.stringify([...row.items,item]),lease:null,leaseUntil:null}});
}
export async function recentChecks(clock:Date){return prisma.dataAgentCheck.findMany({where:{...scope(),cutoff:{lte:clock}},select:{id:true,createdAt:true},orderBy:{createdAt:'desc'},take:10});}
