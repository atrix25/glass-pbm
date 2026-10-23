import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {prisma} from '@/lib/db';
import {hash} from '@/lib/gemma/domain';
import {ServiceError} from '@/lib/service/identity';
import type {ChangeAccess} from '@/lib/benefit-changes/store';
import {goalsSchema,designSchema} from './schema';
import {compare,type Study} from './model';
const scope=(a:ChangeAccess)=>({sponsorId:a.sponsorId,contractId:a.contractId});
export function allow(a:ChangeAccess){if(!a.demoRoles&&!['ops','admin','plan_sponsor'].includes(a.role))throw new ServiceError('Employer planning access required.',403);}
const inputSchema=z.object({command:z.enum(['create','recalculate','select']),requestId:z.string().uuid(),id:z.string().optional(),revision:z.number().int().optional(),goals:goalsSchema.optional(),designs:z.array(designSchema).length(3).refine(d=>new Set(d.map(x=>x.id)).size===3).optional(),selected:z.enum(['experience','balance','cost']).optional()}).strict();
export async function getStudy(a:ChangeAccess,id:string,historical:boolean){allow(a);const row=await prisma.sapphirePlanStudy.findFirst({where:{id,...scope(a),createdAt:{lte:a.at}}});if(!row)throw new ServiceError('Plan comparison not found.',404);const events=await prisma.sapphirePlanStudyEvent.findMany({where:{studyId:id,createdAt:{lte:a.at}},orderBy:{revision:'desc'}});if(!events.length)throw new ServiceError('No evidence available at this date.',404);const snapshot=historical?events[0]:null;return {id,revision:snapshot?.revision??row.revision,data:JSON.parse(snapshot?.data??row.data) as Study,historical,events:events.map(e=>({kind:e.kind,actor:e.actor,at:e.createdAt}))};}
export async function listStudies(a:ChangeAccess){allow(a);const rows=await prisma.sapphirePlanStudy.findMany({where:{...scope(a),createdAt:{lte:a.at}},select:{id:true,createdAt:true},orderBy:{createdAt:'desc'},take:25});return {rows};}
export async function changeStudy(a:ChangeAccess,raw:unknown){allow(a);const b=inputSchema.parse(raw),key=hash([scope(a),b.requestId]),inputHash=hash(b);const prior=await prisma.sapphirePlanStudyEvent.findUnique({where:{requestKey:key}});if(prior){if(prior.inputHash!==inputHash)throw new ServiceError('Request ID already used.',409);return prior.studyId;}
 let existing:Awaited<ReturnType<typeof prisma.sapphirePlanStudy.findFirst>>=null,data:Study;
 if(b.command==='create'||b.command==='recalculate'){if(!b.goals)throw new ServiceError('Employer goals are required.');data=compare(b.goals,b.designs);}
 else {existing=await prisma.sapphirePlanStudy.findFirst({where:{id:b.id??'',...scope(a)}});if(!existing)throw new ServiceError('Plan comparison not found.',404);data=JSON.parse(existing.data);if(!b.selected||!data.options.some(p=>p.design.id===b.selected))throw new ServiceError('Choose a plan.');data.selected=b.selected;data.selectedAt=new Date().toISOString();}
 if(b.command==='recalculate'){existing=await prisma.sapphirePlanStudy.findFirst({where:{id:b.id??'',...scope(a)}});if(!existing)throw new ServiceError('Plan comparison not found.',404);}
 if(existing&&existing.revision!==b.revision)throw new ServiceError('This comparison changed. Refresh before continuing.',409);
 try{return await prisma.$transaction(async tx=>{const id=existing?.id??'study_'+randomUUID(),revision=existing?existing.revision+1:0;
 if(existing){const update=await tx.sapphirePlanStudy.updateMany({where:{id,...scope(a),revision:existing.revision},data:{data:JSON.stringify(data),revision:{increment:1}}});if(!update.count)throw new ServiceError('Concurrent update. Refresh.',409);}
 else await tx.sapphirePlanStudy.create({data:{id,...scope(a),data:JSON.stringify(data)}});
 await tx.sapphirePlanStudyEvent.create({data:{id:randomUUID(),studyId:id,requestKey:key,inputHash,revision,actor:a.actor,kind:b.command,data:JSON.stringify(data)}});return id;
 });}catch(e){const prior=await prisma.sapphirePlanStudyEvent.findUnique({where:{requestKey:key}});if(prior&&prior.inputHash===inputHash)return prior.studyId;throw e;}
}
