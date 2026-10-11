import { NextResponse } from "next/server";
import { answerMember } from "@/lib/agents/member-service/agent";

import {serviceAccess,serviceError} from "@/lib/service/access";
import {askCase} from "@/lib/service/conversation";
import {prisma} from "@/lib/db";
import {serviceToolContext} from "@/lib/service/tool-context";
import {z} from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request:Request){
 try{
 const a=await serviceAccess(request);
 const b=z.object({question:z.string().trim().min(1).max(2000),memberId:z.string(),caseId:z.string().optional(),requestId:z.uuid().optional(),revision:z.number().int().nonnegative().optional()}).parse(await request.json());
 if(!await prisma.member.findFirst({where:{id:b.memberId,sponsorId:a.sponsorId},select:{id:true}}))return NextResponse.json({error:"Member not found"},{status:404});
 if(b.caseId){const c=await prisma.memberServiceCase.findFirst({where:{id:b.caseId,memberId:b.memberId,sponsorId:a.sponsorId,contractId:a.contractId}});if(!c)return NextResponse.json({error:"Case not found"},{status:404});if(!b.requestId||b.revision===undefined)return NextResponse.json({error:"Request ID and revision required"},{status:400});return NextResponse.json(await askCase(a,b.caseId,{question:b.question,requestId:b.requestId,revision:b.revision}));}
 return NextResponse.json(await serviceToolContext.run({memberId:b.memberId,at:a.at,claimId:null,drugName:null},()=>answerMember({question:b.question,memberId:b.memberId,at:a.at})));
 }catch(e){return serviceError(e)}
}
