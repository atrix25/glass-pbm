import {randomUUID,createHash} from 'node:crypto';
import {prisma} from '@/lib/db';
import type {Prisma} from '@/generated/prisma';
import {ServiceError,type Access} from './access';
import {caseState,transition,outcomes,type Kind,type Context,type Command,type Event} from './state';
import {replay} from '@/lib/engine/replay';
import type {SavingsResult} from '@/lib/savings/types';
export const uid=()=>randomUUID();
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const scope=(a:Access)=>({sponsorId:a.sponsorId,contractId:a.contractId});
export async function memberContext(a:Access,memberId:string,claimId?:string){
 const member=await prisma.member.findFirst({where:{id:memberId,sponsorId:a.sponsorId},select:{id:true,firstName:true,lastName:true}});
 if(!member)throw new ServiceError('Member not found.',404);
 const claims=await prisma.claim.findMany({where:{memberId,sponsorId:a.sponsorId,contractId:a.contractId,dateOfService:{lte:a.at},transactionCode:{in:['B1','B3']}},include:{drug:{select:{name:true}},benefitPlan:{select:{name:true}}},orderBy:[{dateOfService:'desc'},{id:'asc'}],take:50});
 if(claimId&&!claims.some(c=>c.id===claimId)){const selected=await prisma.claim.findFirst({where:{id:claimId,memberId,sponsorId:a.sponsorId,contractId:a.contractId,dateOfService:{lte:a.at}},include:{drug:{select:{name:true}},benefitPlan:{select:{name:true}}}});if(selected)claims.unshift(selected);}
 return {member,claims};
}
export async function savingsSource(a:Access,runId:string,optionId:string){
 const job=await prisma.job.findFirst({where:{id:runId,type:'savings-v1',status:'succeeded'}});
 if(!job?.result)throw new ServiceError('Savings result not found.',404);
 const p=JSON.parse(job.payload);if(p.sponsor!==a.sponsorId||p.contract!==a.contractId)throw new ServiceError('Savings result not found.',404);
 const r=JSON.parse(job.result) as SavingsResult;if(new Date(r.cutoff)>a.at)throw new ServiceError('Savings result is later than the selected clock.');
 const option=r.options.find(o=>o.id===optionId);if(!option)throw new ServiceError('Option not found.',404);
 return option;
}
export async function createCase(a:Access,input:{requestId:string;memberId:string;kind:Kind;claimId?:string;runId?:string;optionId?:string}){
 if(input.kind==='benefit'&&!input.runId)throw new ServiceError('Select a savings recommendation for benefit support.');
 if(input.runId&&input.kind!=='benefit')throw new ServiceError('Savings support must use a benefit-change case.');
 const member=await prisma.member.findFirst({where:{id:input.memberId,sponsorId:a.sponsorId}});if(!member)throw new ServiceError('Member not found.',404);
 const claim=input.claimId?await prisma.claim.findFirst({where:{id:input.claimId,memberId:member.id,sponsorId:a.sponsorId,contractId:a.contractId,dateOfService:{lte:a.at}},include:{drug:true,benefitPlan:true}}):null;
 if(input.claimId&&!claim)throw new ServiceError('Claim not found at this cutoff.',404);
 if(input.kind!=='cost'&&!claim)throw new ServiceError('Select a reference claim.');
 const context:Context={claimId:claim?.id??null,claimNumber:claim?.claimNumber??null,drugId:claim?.drugId??null,drugName:claim?.drug.name??null,benefitPlanId:claim?.benefitPlanId??null,benefitName:claim?.benefitPlan.name??null,patientPayCents:claim?.patientPayCents??null,rejectReason:claim?.rejectMessage??null};
 if(input.runId&&input.optionId){const o=await savingsSource(a,input.runId,input.optionId),m=o.disruptions.find(d=>d.memberId===member.id);if(!m)throw new ServiceError('This member is not in the saved affected population.');if(!claim||!m.claimIds.includes(claim.id))throw new ServiceError('Select an affected claim.');const amounts=m as typeof m & {beforeCents?:number;afterCents?:number};context.source={runId:input.runId,optionId:o.id,title:o.title,claimIds:m.claimIds,higherCost:m.higherCost,accessChange:m.accessChange,beforeCents:amounts.beforeCents??null,afterCents:amounts.afterCents??null,deltaCents:amounts.beforeCents===undefined||amounts.afterCents===undefined?null:amounts.afterCents-amounts.beforeCents,override:o.override};}
 const sourceKey=hash({scope:scope(a),source:input.runId?{run:input.runId,option:input.optionId,member:member.id}:input.requestId});
 const existing=await prisma.memberServiceCase.findUnique({where:{sourceKey}});if(existing){if(existing.memberId!==input.memberId||existing.kind!==input.kind||JSON.parse(existing.context).claimId!==context.claimId)throw new ServiceError('Request already used for a different case.',409);return existing.id;}
 if(context.source){
 const job=await prisma.job.findUniqueOrThrow({where:{id:context.source.runId}});const cutoff=new Date(JSON.parse(job.payload).cutoff);
 const baseline=await replay({}, {memberId:member.id,asOf:cutoff,maxDiffs:0});
 if(baseline.claimsChanged!==0)throw new ServiceError('Baseline no longer reproduces saved claims. Re-run savings before planning support.');
 const r=await replay(context.source.override as Parameters<typeof replay>[0],{memberId:member.id,asOf:cutoff,maxDiffs:0});
 context.source.beforeCents=r.memberPaidBeforeCents;context.source.afterCents=r.memberPaidAfterCents;context.source.deltaCents=r.memberPaidAfterCents-r.memberPaidBeforeCents;
 }
 const id='svc_'+uid(),sessionId=uid();
 const title=input.kind==='cost'?'Prescription cost':input.kind==='authorization'?'Authorization and access':'Benefit change support';
 try{await prisma.$transaction(async tx=>{
 await tx.chatSession.create({data:{id:sessionId,memberId:member.id,title}});
 await tx.memberServiceCase.create({data:{id,...scope(a),memberId:member.id,memberName:`${member.firstName} ${member.lastName}`,title,kind:input.kind,team:'Member services',sessionId,sourceKey,context:JSON.stringify(context),evidenceAt:a.at}});
 await tx.memberServiceEvent.create({data:{id:uid(),caseId:id,seq:0,type:'created',status:'Open',team:'Member services',summary:'Case opened. Reference benefits apply; external actions are simulated.',actor:a.actor,evidenceAt:a.at}});
 });}catch(e){const duplicate=await prisma.memberServiceCase.findUnique({where:{sourceKey}});if(duplicate&&duplicate.memberId===input.memberId&&duplicate.kind===input.kind&&JSON.parse(duplicate.context).claimId===context.claimId)return duplicate.id;throw e;}
 return id;
}
export async function getCase(a:Access,id:string){
 const c=await prisma.memberServiceCase.findFirst({where:{id,...scope(a),evidenceAt:{lte:a.at}},include:{events:{where:{evidenceAt:{lte:a.at}},orderBy:{seq:'asc'}}}});
 if(!c)throw new ServiceError('Case not found at this cutoff.',404);
 // Validate current member ownership too; IDs supplied by callers are never trusted.
 if(!await prisma.member.findFirst({where:{id:c.memberId,sponsorId:a.sponsorId},select:{id:true}}))throw new ServiceError('Member not found.',404);
 const state=caseState(c.kind as Kind,c.events);const context=JSON.parse(c.context) as Context;
 const messages=c.events.filter(e=>['question','answer','failure','clarification'].includes(e.type)).map(e=>({...e,data:JSON.parse(e.payload)}));
 return {...c,...state,context,messages,historical:c.events.at(-1)?.seq!==c.revision,at:a.at.toISOString()};
}
export async function listCases(a:Access,params:URLSearchParams){
 const search=(params.get('q')??'').slice(0,100),status=params.get('status')??'',team=params.get('team')??'',page=Math.max(1,Math.min(100000,Math.floor(Number(params.get('page')))||1));
 // Last visible event supplies historical state, rather than the current mutable projection.
 const rows=await prisma.$queryRaw<{id:string;memberName:string;title:string;status:string;team:string;updatedAt:Date;kind:string;total:bigint}[]>`
 SELECT c."id",c."memberName",c."title",e."status",e."team",e."createdAt" AS "updatedAt",c."kind",COUNT(*) OVER() AS "total"
 FROM "MemberServiceCase" c JOIN LATERAL (SELECT * FROM "MemberServiceEvent" ev WHERE ev."caseId"=c."id" AND ev."evidenceAt"<=${a.at.toISOString()}::timestamp ORDER BY ev."seq" DESC LIMIT 1) e ON true
 WHERE c."sponsorId"=${a.sponsorId} AND c."contractId"=${a.contractId} AND c."evidenceAt"<=${a.at.toISOString()}::timestamp
 AND (${search}='' OR c."memberName" ILIKE ${'%'+search+'%'} OR c."title" ILIKE ${'%'+search+'%'})
 AND (${status}='' OR e."status"=${status}) AND (${team}='' OR e."team"=${team})
 ORDER BY e."createdAt" DESC,c."id" LIMIT 25 OFFSET ${(page-1)*25}`;
 return {rows:rows.map(({total,...r})=>({...r,total:undefined})),total:Number(rows[0]?.total??0),page};
}
export async function getOutcomes(a:Access){const rows=await prisma.memberServiceCase.findMany({where:{...scope(a),evidenceAt:{lte:a.at}},include:{events:{where:{evidenceAt:{lte:a.at}},orderBy:{seq:'asc'}}}});return outcomes(rows.map(c=>({kind:c.kind as Kind,events:c.events})));}
export async function mutate(a:Access,id:string,requestId:string,revision:number,kind:string,input:unknown,work:(tx:Prisma.TransactionClient,c:Awaited<ReturnType<typeof getCase>>,seq:number)=>Promise<void>){
 const inputHash=hash({kind,input});
 const c=await getCase(a,id);
 await prisma.$transaction(async tx=>{
 const prior=await tx.memberServiceAction.findUnique({where:{caseId_requestId:{caseId:id,requestId}}});
 if(prior){const owner=await tx.memberServiceCase.findFirst({where:{id,...scope(a)}});if(!owner)throw new ServiceError('Case not found.',404);if(prior.inputHash!==inputHash)throw new ServiceError('Request ID already used.',409);return;}
 if(c.historical)throw new ServiceError('Advance the clock to the latest case event before editing.',409);
 const lock=await tx.memberServiceCase.updateMany({where:{id,...scope(a),revision},data:{revision:{increment:1},updatedAt:new Date()}});if(!lock.count)throw new ServiceError('Case changed. Refresh before continuing.',409);
 await work(tx,c,revision+1);
 await tx.memberServiceAction.create({data:{id:uid(),caseId:id,requestId,inputHash,kind,status:'Recorded',payload:JSON.stringify(input)}});
 });
 return getCase(a,id);
}
export async function act(a:Access,id:string,input:{requestId:string;revision:number;command:Command;note:string}){
 return mutate(a,id,input.requestId,input.revision,input.command,{command:input.command,note:input.note},async(tx,c,seq)=>{
 if(input.command==='recover'&&Date.now()-new Date(c.events.at(-1)!.createdAt).getTime()<120000)throw new ServiceError('Allow two minutes before recovering an interrupted answer.',409);
 if(input.command==='activate'&&!c.context.source)throw new ServiceError('Select a saved savings option to simulate a benefit change.');
 const next=transition(c.kind as Kind,c.events,input.command,input.note,!!c.context.claimId);
 await tx.memberServiceCase.update({where:{id},data:{status:next.status,team:next.team}});
 await tx.memberServiceEvent.create({data:{id:uid(),caseId:id,seq,type:input.command,...next,actor:a.actor,simulated:true,evidenceAt:a.at,payload:JSON.stringify({note:input.note,memberId:c.memberId,drugId:c.context.drugId,claimId:c.context.claimId,source:input.command==='activate'?c.context.source:undefined,evidenceId:['fill-response','authorization-response'].includes(input.command)?'sim_'+uid():undefined})}});
 });
}
