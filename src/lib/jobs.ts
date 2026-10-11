import { prisma } from '@/lib/db';
import { Prisma } from '@/generated/prisma';
export type JobType='replay'|'nps_snapshot'|'rollup_refresh'|'enrich_batch'|'gemma-tick'|'gemma-validate';
export type EnqueueJobInput={type:JobType|string;payload?:Record<string,unknown>;createdById?:string|null;maxAttempts?:number};
export async function enqueueJob(input:EnqueueJobInput){return prisma.job.create({data:{type:input.type,payload:JSON.stringify(input.payload??{}),createdById:input.createdById,maxAttempts:input.maxAttempts??3}})}
export async function getJob(id:string){return prisma.job.findUnique({where:{id},include:{runs:true}})}
export async function claimNextJob(workerId:string,queue:'default'|'gemma'='default'){
 const now=new Date(),scope=queue==='gemma'?{type:'gemma-tick'}:{type:{not:'gemma-tick'}};
 return prisma.$transaction(async tx=>{
 const stale=await tx.job.findMany({where:{...scope,status:'running',OR:[{leaseUntil:{lt:now}},{leaseUntil:null,startedAt:{lt:new Date(now.getTime()-300000)}}]},select:{id:true,attempts:true,maxAttempts:true}});
 for(const job of stale){const changed=await tx.job.updateMany({where:{id:job.id,status:'running',OR:[{leaseUntil:{lt:now}},{leaseUntil:null,startedAt:{lt:new Date(now.getTime()-300000)}}]},data:{status:job.attempts>=job.maxAttempts?'failed':'pending',leaseOwner:null,leaseUntil:null,error:'Worker lease expired; interrupted execution recovered.'}});if(changed.count)await tx.jobRun.updateMany({where:{jobId:job.id,finishedAt:null},data:{finishedAt:now,error:'Lease expired'}})}
 const candidate=await tx.job.findFirst({where:{...scope,status:'pending',attempts:{lt:prisma.job.fields.maxAttempts}},orderBy:{createdAt:'asc'}});
 if(!candidate||candidate.attempts>=candidate.maxAttempts)return null;
 const claimed=await tx.job.updateMany({where:{id:candidate.id,status:'pending',attempts:candidate.attempts},data:{status:'running',startedAt:now,attempts:{increment:1},leaseOwner:workerId,leaseUntil:new Date(now.getTime()+180000)}});
 if(!claimed.count)return null;
 const job=await tx.job.findUniqueOrThrow({where:{id:candidate.id}});
 await tx.jobRun.create({data:{jobId:job.id,workerId}});return job;
 });
}
export async function renewJobLease(id:string,workerId:string){return prisma.job.updateMany({where:{id,status:'running',leaseOwner:workerId,leaseUntil:{gt:new Date()}},data:{leaseUntil:new Date(Date.now()+180000)}})}
export async function completeJob(id:string,result:Record<string,unknown>,workerId?:string){await prisma.$transaction(async tx=>{const changed=await tx.job.updateMany({where:{id,status:'running',...(workerId?{leaseOwner:workerId,leaseUntil:{gt:new Date()}}:{})},data:{status:'succeeded',progress:1,result:JSON.stringify(result),finishedAt:new Date(),error:null,leaseOwner:null,leaseUntil:null}});if(!changed.count)throw Error('Job lease lost. Result was not committed.');await tx.jobRun.updateMany({where:{jobId:id,finishedAt:null},data:{finishedAt:new Date()}})})}
export async function failJob(id:string,error:string,workerId?:string){await prisma.$transaction(async tx=>{const job=await tx.job.findUnique({where:{id}});if(!job||job.status!=='running'||(workerId&&job.leaseOwner!==workerId))return;const changed=await tx.job.updateMany({where:{id,status:'running',leaseOwner:job.leaseOwner,attempts:job.attempts},data:{status:job.attempts<job.maxAttempts?'pending':'failed',error,finishedAt:new Date(),leaseOwner:null,leaseUntil:null}});if(!changed.count)return;await tx.jobRun.updateMany({where:{jobId:id,finishedAt:null},data:{finishedAt:new Date(),error}})})}
export async function setJobProgress(id:string,progress:number){await prisma.job.update({where:{id},data:{progress:Math.min(1,Math.max(0,progress))}})}
export {Prisma};
