import {prisma} from '@/lib/db';
import {resolveClock} from '@/lib/clock';
import {tenantSponsorId,tenantContractId} from '@/lib/config';
import {key,generationSlots,mayGenerate,GENERATOR_VERSION,type Scope} from './domain';
export const deploymentScope=():Scope=>({sponsorId:tenantSponsorId(),contractId:tenantContractId()});
export async function ensureMonitor(scope=deploymentScope()){
 const id=key(scope,'monitor');const existing=await prisma.gemmaMonitor.findUnique({where:{id}});if(existing)return existing;
 const population=await prisma.member.count({where:{sponsorId:scope.sponsorId}}),claims=await prisma.claim.count({where:scope});
 return prisma.gemmaMonitor.upsert({where:{id},create:{id,...scope,population,claims},update:{}});
}
export async function enqueueTick(scope=deploymentScope(),now=new Date()){
 const m=await ensureMonitor(scope);await prisma.gemmaMonitor.update({where:{id:m.id},data:{heartbeatAt:now}});if(!m.enabled)return null;
 const id=key(scope,'tick',generationSlots(now).member);
 return prisma.job.upsert({where:{id},create:{id,type:'gemma-tick',payload:JSON.stringify({scope,at:now.toISOString()}),maxAttempts:3},update:{}});
}
export async function collectSignals(scope:Scope,now=new Date()){
 const m=await ensureMonitor(scope);if(!m.enabled)return {paused:true};
 const live=resolveClock(undefined).now;
 const cutoff=m.cutoff??live;
 const rows=await prisma.claim.findMany({where:{...scope,id:{gt:m.cursor},dateOfService:{lte:cutoff}},select:{id:true,memberId:true,drugId:true,dateOfService:true,responseStatus:true,rejectCodes:true},orderBy:{id:'asc'},take:1000});
 // Persist the findings and cursor in one transaction. Only authorization rejects are auto-routed here.
 await prisma.$transaction(async tx=>{
 for(const c of rows.filter(r=>r.responseStatus==='R'&&JSON.parse(r.rejectCodes).includes('75'))){const id=key(scope,'reference',c.id);await tx.gemmaSignal.upsert({where:{id},create:{id,...scope,sourceKey:id,kind:'access',provenance:'Reference finding',payload:JSON.stringify({claimId:c.id,group:`reference:${m.cursor}:${c.drugId}:${c.dateOfService.toISOString().slice(0,10)}`,generator:GENERATOR_VERSION}),evidenceAt:now},update:{}})}
 await tx.gemmaMonitor.update({where:{id:m.id},data:{...(rows.length?{cursor:rows.at(-1)!.id,scanned:{increment:rows.length}}:{}),cutoff,...(!rows.length&&cutoff.toISOString().slice(0,10)!==live.toISOString().slice(0,10)?{cursor:"",scanned:0,cutoff:live}:{}),updatedAt:now}});
 });
 const backlog=await prisma.gemmaSignal.count({where:{...scope,state:'Pending',provenance:'Synthetic event'}});
 if(mayGenerate(backlog)){
 const slot=generationSlots(now);
 let c=await prisma.claim.findFirst({where:{...scope,id:{gt:m.generatorCursor},dateOfService:{lte:cutoff},responseStatus:'R',rejectCodes:{contains:'75'}},orderBy:{id:'asc'},select:{id:true,drugId:true}});
 if(!c)c=await prisma.claim.findFirst({where:{...scope,dateOfService:{lte:cutoff},responseStatus:'R',rejectCodes:{contains:'75'}},orderBy:{id:'asc'},select:{id:true,drugId:true}});
 if(c){await prisma.$transaction(async tx=>{for(const [kind,bucket] of [['access',slot.member],['external',slot.external]] as const){const id=key(scope,'synthetic',kind,bucket);await tx.gemmaSignal.upsert({where:{id},create:{id,...scope,sourceKey:id,kind,provenance:'Synthetic event',payload:JSON.stringify({claimId:c!.id,drugId:c!.drugId,group:id,generator:GENERATOR_VERSION,event:kind==='access'?'Simulated member requests help with this reference rejection. This is not a new operational claim.':'Synthetic documentation-policy update. No live public-source monitoring or real clinical recommendation.'}),evidenceAt:now},update:{}})}await tx.gemmaMonitor.update({where:{id:m.id},data:{generatorCursor:c!.id}})})}
 // One employer trend evaluation per day, not one expensive replay per member.
 const id=key(scope,'trend',slot.savings);await prisma.gemmaSignal.upsert({where:{id},create:{id,...scope,sourceKey:id,kind:'savings',provenance:'Reference trend check',payload:JSON.stringify({group:id,cutoff:cutoff.toISOString(),generator:GENERATOR_VERSION}),evidenceAt:now},update:{}});
 }
 return {scanned:rows.length,generatedBacklog:backlog,backpressure:!mayGenerate(backlog)};
}
