import {prisma} from '@/lib/db';
import {answerMember} from '@/lib/agents/member-service/agent';
import {extractDrug} from '@/lib/agent/plan';
import {serviceToolContext} from './tool-context';
import {mutate,getCase,uid} from './store';
import {type Access,ServiceError} from './access';
import type {Kind} from './state';
export async function askCase(a:Access,id:string,input:{requestId:string;revision:number;question:string}){
 let started=false;
 const reserved=await mutate(a,id,input.requestId,input.revision,'question',{question:input.question},async(tx,c,seq)=>{
 if(c.status==='Resolved')throw new ServiceError('Reopen this case to continue.');if(c.pending)throw new ServiceError('An answer is already running.',409);
 await tx.chatMessage.create({data:{sessionId:c.sessionId,role:'user',content:input.question}});
 await tx.memberServiceEvent.create({data:{id:uid(),caseId:id,seq,type:'question',status:'In progress',team:c.team,summary:input.question,actor:'Simulated member',simulated:true,evidenceAt:a.at,payload:JSON.stringify({question:input.question})}});
 await tx.memberServiceCase.update({where:{id},data:{status:'In progress'}});started=true;
 });
 if(!started)return reserved;
 let answer:Awaited<ReturnType<typeof answerMember>>|null=null,clarification:string|null=null,failure:string|null=null;
 try{
 await serviceToolContext.run({memberId:reserved.memberId,at:a.at,claimId:reserved.context.claimId,drugName:reserved.context.drugName},async()=>{
 const mention=await extractDrug(input.question,reserved.memberId);
 if(/\b(that one|other one|the alternative|second option|another claim)\b/i.test(input.question))clarification="Please name the drug or claim you mean so I do not use the wrong record.";
 else if(mention.ambiguous)clarification="You mentioned more than one drug. Please ask about one drug at a time, or open a separate case for another claim.";
 else if(!reserved.context.claimId)clarification='Select a reference claim when opening a case so I can check the correct drug, benefit and charge.';
 else if(mention.unrecognised)clarification=`I could not identify ${mention.unrecognised}. Please confirm the drug and open a case for its claim.`;
 else if(mention.drug&&reserved.context.drugName&&!reserved.context.drugName.toLowerCase().includes(mention.drug.toLowerCase()))clarification='This question appears to concern a different drug. Open a separate case and select its claim so the records stay together.';
 else answer=await answerMember({question:input.question,memberId:reserved.memberId,at:a.at,context:{claimId:reserved.context.claimId,drugName:reserved.context.drugName}});
 });
 }catch{failure='A required tool could not complete. The case remains open. Retry the question or prepare a staff handoff.';}
 const response=answer as Awaited<ReturnType<typeof answerMember>>|null;
 const usable=!!response&&!response.handoff&&response.work.length>0&&response.work.every(w=>!w.error&&!(w.data&&typeof w.data==='object'&&'found' in w.data&&w.data.found===false));
 await prisma.$transaction(async tx=>{
 const lock=await tx.memberServiceCase.updateMany({where:{id,revision:reserved.revision},data:{revision:{increment:1},status:usable?'In progress':'Open',updatedAt:new Date()}});if(!lock.count)return; // Recovery or a later action owns the case now.
 const text=failure??clarification??response?.paragraphs.join('\n\n')??'No answer available.';
 await tx.chatMessage.create({data:{sessionId:reserved.sessionId,role:'assistant',content:text,toolCalls:JSON.stringify(response?.work??[]),citations:JSON.stringify(response?.citations??[])}});
 await tx.memberServiceEvent.create({data:{id:uid(),caseId:id,seq:reserved.revision+1,type:failure?'failure':clarification?'clarification':'answer',status:usable?'In progress':'Open',team:reserved.team,summary:text,actor:'Member service agent',simulated:false,evidenceAt:a.at,payload:JSON.stringify({answer:response,usable,execution:'Scripted routing and deterministic tools',benefitVersion:reserved.context.benefitPlanId,cutoff:a.at.toISOString(),kind:reserved.kind as Kind})}});
 });
 return getCase(a,id);
}
