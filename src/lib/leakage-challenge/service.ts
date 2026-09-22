import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import { tenantSponsorId } from '@/lib/config';
import type { SponsorKey } from '../contract-checks/profiles';
import type { Evidence, Detection } from '../contract-checks/detector';
import { inject,digest } from './injector';
import { runDetector,DETECTOR_VERSION } from './runner';
import { score,type ChallengeScore } from './evaluator';
import type { AnswerKey } from './types';
export async function createChallenge(sponsor:SponsorKey,key:string,size:200|1000){
 const tenantId=tenantSponsorId(),unique=createHash('sha256').update(`${tenantId}:${sponsor}:${key}`).digest('hex');
 const pack=inject(sponsor,randomBytes(32).toString('hex'),randomBytes(32).toString('hex'),size,size===200?24:120);
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(74839212)::text`;
  const old=await tx.leakageChallenge.findUnique({where:{key:unique}});
  if(old){if((JSON.parse(old.sealedAnswer) as AnswerKey).originalClaimIds.length!==size)throw Error('Request key has different inputs');return old.id;}
  const id=`lch_${randomUUID()}`;
  await tx.leakageChallenge.create({data:{id,key:unique,tenantId,sponsorId:sponsor,cutoff:new Date(pack.cutoff),input:JSON.stringify(pack.input),inputHash:pack.inputHash,sealedAnswer:JSON.stringify(pack.answer),commitment:pack.commitment}});return id;
 });
}
export async function evaluateChallenge(id:string,sponsor:SponsorKey,clock:Date){
 // Read only the corrupted input for execution. The detector never receives the answer.
 const row=await prisma.leakageChallenge.findFirst({where:{id,sponsorId:sponsor,tenantId:tenantSponsorId()},select:{id:true,input:true,inputHash:true,cutoff:true,score:true}});
 if(!row||row.cutoff>clock)throw Error('Challenge unavailable');if(row.score)return;
 const input=JSON.parse(row.input) as Evidence;if(digest(input)!==row.inputHash)throw Error('Evidence integrity check failed');
 const result=runDetector(input,row.cutoff.toISOString());
 await prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(74839212)::text`;
  const sealed=await tx.leakageChallenge.findFirst({where:{id,sponsorId:sponsor,tenantId:tenantSponsorId()}});
  if(!sealed)throw Error('Challenge unavailable');if(sealed.score)return;
  const answer=JSON.parse(sealed.sealedAnswer) as AnswerKey;
  if(digest(answer)!==sealed.commitment||sealed.inputHash!==row.inputHash)throw Error('Evidence integrity check failed');
  await tx.leakageChallenge.update({where:{id},data:{result:JSON.stringify(result),score:JSON.stringify(score(answer,result)),scoredAt:new Date(),detectorVersion:DETECTOR_VERSION}});
 });
}
export async function readChallenge(id:string,sponsor:SponsorKey,clock:Date){
 const row=await prisma.leakageChallenge.findFirst({where:{id,sponsorId:sponsor,tenantId:tenantSponsorId()}});
 if(!row||row.cutoff>clock)return null;
 // Explicit response allowlist. No answer, salt, seed or clean baseline until scoring completes.
 return {id:row.id,sponsor:row.sponsorId,cutoff:row.cutoff.toISOString(),createdAt:row.createdAt.toISOString(),scoredAt:row.scoredAt?.toISOString()??null,commitment:row.commitment,inputHash:row.inputHash,input:JSON.parse(row.input) as Evidence,
  detectorVersion:row.detectorVersion,result:row.result?JSON.parse(row.result) as Detection:null,score:row.score?JSON.parse(row.score) as ChallengeScore:null,
  answer:row.score?JSON.parse(row.sealedAnswer) as AnswerKey:null};
}
export type Challenge=NonNullable<Awaited<ReturnType<typeof readChallenge>>>;
export async function recentChallenges(sponsor:SponsorKey,clock:Date){return prisma.leakageChallenge.findMany({where:{sponsorId:sponsor,tenantId:tenantSponsorId(),cutoff:{lte:clock}},select:{id:true,createdAt:true,scoredAt:true},orderBy:{createdAt:'desc'},take:10});}
