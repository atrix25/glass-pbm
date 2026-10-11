import {prisma} from '@/lib/db';
import {type Access,ServiceError} from '@/lib/service/identity';
import {decisionAllowed,hash,key,messageState,monitorHealth} from './domain';
import {assertSources} from './processor';
export async function overview(a:Access,p:URLSearchParams,historical=false){
 const scope={sponsorId:a.sponsorId,contractId:a.contractId}, member=p.get('member'),caseId=p.get('case'),savings=p.get('savings');
 const where={...scope,evidenceAt:{lte:a.at},...(member||caseId?{subjects:{some:{...(member?{memberId:member}:{}),...(caseId?{caseId}:{}),evidenceAt:{lte:a.at}}}}:{}),...(savings?{savingsJobId:savings}:{})};
 const monitor=await prisma.gemmaMonitor.findUnique({where:{sponsorId_contractId:scope}});
 const page=Math.max(1,Math.min(100000,Number(p.get('page'))||1)),status=p.get('status'),kind=p.get('kind'),q=p.get('q')?.slice(0,100);
 const filter={...where,...(status==='attention'?{OR:[{status:{in:['Failed','Blocked']}},{communications:{some:{failedAt:{lte:a.at}}}}]}:status?{status}:{}),...(kind?{kind}:{}),...(q?{title:{contains:q,mode:'insensitive' as const}}:{})};
 let rows,total,counts:Record<string,number>={};
 if(historical){
 const old=await prisma.gemmaWorkflow.findMany({where,select:{id:true,kind:true,title:true,team:true,memberCount:true,evidenceAt:true,activity:{where:{evidenceAt:{lte:a.at},NOT:[{type:{startsWith:'communication-'}},{type:'interpretation'},{type:'messages-prepared'}]},orderBy:{evidenceAt:'desc'},take:1}}});
 const snapshots=old.map(w=>({...w,status:w.activity[0]?.status??'Detected',updatedAt:w.activity[0]?.evidenceAt??w.evidenceAt,memberCount:null}));for(const w of snapshots)counts[w.status]=(counts[w.status]??0)+1;
 const selected=snapshots.filter(w=>(!status||(status==='attention'?['Failed','Blocked'].includes(w.status):w.status===status))&&(!kind||w.kind===kind)&&(!q||w.title.toLowerCase().includes(q.toLowerCase()))).sort((a,b)=>b.updatedAt.getTime()-a.updatedAt.getTime());total=selected.length;rows=selected.slice((page-1)*25,page*25);
 }else{
 const result=await Promise.all([prisma.gemmaWorkflow.findMany({where:filter,select:{id:true,kind:true,title:true,team:true,memberCount:true,status:true,updatedAt:true,evidenceAt:true},orderBy:{updatedAt:'desc'},skip:(page-1)*25,take:25}),prisma.gemmaWorkflow.count({where:filter}),prisma.gemmaWorkflow.groupBy({by:['status'],where,_count:true})]);rows=result[0];total=result[1];for(const g of result[2])counts[g.status]=g._count;
 }
 const pending=await prisma.gemmaSignal.count({where:{...scope,state:'Pending',evidenceAt:{lte:a.at}}});
 const errors=await prisma.gemmaSignal.count({where:{...scope,state:'Pending',attempts:{gte:3},evidenceAt:{lte:a.at}}});
 const attention=historical?(counts.Failed??0)+(counts.Blocked??0):await prisma.gemmaWorkflow.count({where:{...where,OR:[{status:{in:['Failed','Blocked']}},{communications:{some:{failedAt:{lte:a.at}}}}]}});
 return {rows,total,page,pages:Math.max(1,Math.ceil(total/25)),counts,attention,awaiting:counts['Awaiting approval']??0,completed:counts.Verified??0,historical,updatedAt:new Date(),monitor:monitor?{...monitor,health:historical?'Historical view':monitorHealth(monitor.enabled,monitor.heartbeatAt,monitor.checkedAt,monitor.lastError),...(historical?{heartbeatAt:null,checkedAt:null,scanned:null,cursor:undefined,generatorCursor:undefined,lastError:null}:{}),pending,errors}:null};
}
export async function detail(a:Access,id:string,p:URLSearchParams,historical=false){
 const w=await prisma.gemmaWorkflow.findFirst({where:{id,sponsorId:a.sponsorId,contractId:a.contractId,evidenceAt:{lte:a.at}}});if(!w)throw new ServiceError('Work not found.',404);
 const page=Math.max(1,Number(p.get('membersPage'))||1);
 const [activities,subjects,messages,decisions,policies]=await Promise.all([
 prisma.gemmaActivity.findMany({where:{workflowId:id,evidenceAt:{lte:a.at}},orderBy:{evidenceAt:'asc'}}),
 prisma.gemmaSubject.findMany({where:{workflowId:id,evidenceAt:{lte:a.at}},orderBy:{memberId:'asc'},skip:(page-1)*25,take:25}),
 prisma.gemmaCommunication.findMany({where:{workflowId:id,preparedAt:{lte:a.at}},orderBy:{preparedAt:'asc'},skip:(page-1)*25,take:25}),
 prisma.gemmaDecision.findMany({where:{workflowId:id,createdAt:{lte:a.at}},orderBy:{createdAt:'asc'}}),
 prisma.gemmaPolicy.findMany({where:{workflowId:id,approvedAt:{lte:a.at}}})]);
 const state=activities.filter(e=>!e.type.startsWith('communication-')&&!['interpretation','messages-prepared'].includes(e.type)).at(-1);
 const snapshot=historical?activities.filter(e=>{try{return !!JSON.parse(e.payload).proposal}catch{return false}}).at(-1)?.payload??'{}':w.data;
 const subjectCount=await prisma.gemmaSubject.count({where:{workflowId:id,evidenceAt:{lte:a.at}}});
 return {...w,status:historical?state?.status??'Detected':w.status,memberCount:subjectCount,data:JSON.parse(snapshot),proposalHash:historical?null:w.proposalHash,activities:activities.map(x=>({...x,payload:JSON.parse(x.payload)})),subjects:subjects.map(x=>({...x,caseId:historical?null:x.caseId})),messages:messages.map(m=>({...m,status:historical?(activities.filter(e=>e.type.startsWith('communication-')&&JSON.parse(e.payload).messageId===m.id).at(-1)?.type.replace('communication-','').replace(/^./,c=>c.toUpperCase())??'Prepared'):messageState(m,a.at),sentAt:m.sentAt&&m.sentAt<=a.at?m.sentAt:null,deliveredAt:m.deliveredAt&&m.deliveredAt<=a.at?m.deliveredAt:null,acknowledgedAt:m.acknowledgedAt&&m.acknowledgedAt<=a.at?m.acknowledgedAt:null,failedAt:m.failedAt&&m.failedAt<=a.at?m.failedAt:null})),decisions,policies:policies.map(x=>historical?{id:x.id,kind:x.kind,approvedAt:x.approvedAt,status:x.effectiveAt&&x.effectiveAt<=a.at?'Active':'Approved',effectiveAt:x.effectiveAt&&x.effectiveAt<=a.at?x.effectiveAt:null}:x),page,pages:Math.max(1,Math.ceil(subjectCount/25)),historical};
}
export async function review(a:Access,id:string,input:{requestId:string;revision:number;proposalHash:string;decision:'Approve'|'Reject';note:string}){
 const requestHash=hash(input),scope={sponsorId:a.sponsorId,contractId:a.contractId};
 const w=await prisma.gemmaWorkflow.findFirst({where:{id,...scope}});if(!w)throw new ServiceError('Work not found.',404);
 const prior=await prisma.gemmaDecision.findUnique({where:{workflowId_requestId:{workflowId:id,requestId:input.requestId}}});if(prior){if(prior.inputHash!==requestHash)throw new ServiceError('Request ID already used.',409);return prior;}
 decisionAllowed(w.status,input.proposalHash,w.proposalHash,input.revision,w.revision);if(input.decision==='Approve')await assertSources(w);
 const data=JSON.parse(w.data),now=new Date(),approved=input.decision==='Approve';
 return prisma.$transaction(async tx=>{
 const changed=await tx.gemmaWorkflow.updateMany({where:{id,revision:input.revision,status:'Awaiting approval',proposalHash:input.proposalHash},data:{status:approved?'Approved':'Rejected',revision:{increment:1},updatedAt:now}});if(!changed.count)throw new ServiceError('Work changed. Refresh before reviewing.',409);
 const decision=await tx.gemmaDecision.create({data:{id:key(id,input.requestId),workflowId:id,requestId:input.requestId,inputHash:requestHash,decision:input.decision,actor:a.actor,note:input.note,proposalHash:input.proposalHash}});
 if(approved)await tx.gemmaPolicy.create({data:{id:key(id,input.proposalHash,'policy'),workflowId:id,...scope,kind:w.kind==='external'?'clinical':w.kind==='savings'?'benefit':'access',target:w.kind==='external'?data.proposal.drugId:w.kind==='savings'?'employer':id,payload:JSON.stringify(data.proposal),contentHash:input.proposalHash,approvedBy:a.actor,approvedAt:now,validation:'{}'}});
 await tx.gemmaActivity.create({data:{id:key(decision.id,'event'),key:key(decision.id,'event'),workflowId:id,type:'review',status:approved?'Approved':'Rejected',summary:`${a.actor} ${approved?'approved':'rejected'} this version in simulation. ${input.note}`,agentId:'gemma',payload:JSON.stringify({decisionId:decision.id,proposalHash:input.proposalHash,simulated:true}),evidenceAt:now}});return decision;
 });
}
export async function respond(a:Access,id:string,messageId:string,input:{requestId:string;revision:number;command:'retry'|'deliver'|'acknowledge'|'fail'}){
 const w=await prisma.gemmaWorkflow.findFirst({where:{id,sponsorId:a.sponsorId,contractId:a.contractId}});if(!w)throw new ServiceError('Work not found.',404);
 const eventKey=key(id,messageId,input.requestId),inputHash=hash(input),now=new Date();
 return prisma.$transaction(async tx=>{
 const prior=await tx.gemmaActivity.findUnique({where:{key:eventKey}});if(prior){if(JSON.parse(prior.payload).inputHash!==inputHash)throw new ServiceError('Request ID already used.',409);return prior;}
 const m=await tx.gemmaCommunication.findFirst({where:{id:messageId,workflowId:id}});if(!m)throw new ServiceError('Message not found.',404);
 if(input.command==='retry'&&!['Failed','Sent'].includes(m.status)||input.command==='deliver'&&m.status!=='Sent'||input.command==='acknowledge'&&m.status!=='Delivered'||input.command==='fail'&&m.status!=='Sent')throw new ServiceError('Message is not eligible for this response.',409);
 const changed=await tx.gemmaWorkflow.updateMany({where:{id,revision:input.revision},data:{revision:{increment:1},updatedAt:now}});if(!changed.count)throw new ServiceError('Work changed. Refresh and retry.',409);
 const status=input.command==='retry'?'Prepared':input.command==='deliver'?'Delivered':input.command==='acknowledge'?'Acknowledged':'Failed';
 await tx.gemmaCommunication.update({where:{id:messageId},data:{status,...(input.command==='retry'?{simulationOutcome:'Acknowledge',sentAt:null,deliveredAt:null,acknowledgedAt:null,failedAt:null}:input.command==='deliver'?{deliveredAt:now}:input.command==='acknowledge'?{acknowledgedAt:now}:{failedAt:now})}});
 return tx.gemmaActivity.create({data:{id:eventKey,key:eventKey,workflowId:id,type:'communication-'+status.toLowerCase(),status:w.status,summary:`${a.actor} recorded a simulated ${input.command==='retry'?'delivery retry':input.command+' response'}.`,agentId:'gemma-communications',payload:JSON.stringify({messageId,memberId:m.memberId,inputHash,command:input.command,messageStatus:status,simulated:true}),evidenceAt:now}});
 });
}
