import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { tenantSponsorId } from "@/lib/config";
import { detect, type Detection, type Evidence } from "./detector";
import { evidenceFor } from "./evidence";
import { PROFILES, type SponsorKey } from "./profiles";
export async function saveCheck(sponsor:SponsorKey,cutoff:string,requestKey:string){
  const input=evidenceFor(sponsor),result=detect(input,cutoff),tenantId=tenantSponsorId();
  const key=createHash("sha256").update(JSON.stringify({tenantId,sponsor,cutoff,requestKey})).digest("hex");
  return prisma.$transaction(async tx=>{
    await tx.contractDemoSponsor.upsert({where:{id:sponsor},create:{id:sponsor,name:PROFILES[sponsor].name,source:PROFILES[sponsor].source},update:{}});
    return tx.contractCheckRun.upsert({where:{key},update:{},create:{id:`cck_${randomUUID()}`,key,tenantId,sponsorId:sponsor,cutoff:new Date(cutoff),input:JSON.stringify(input),result:JSON.stringify(result)}});
  });
}
export async function readCheck(id:string,sponsor:SponsorKey){
  const run=await prisma.contractCheckRun.findFirst({where:{id,sponsorId:sponsor,tenantId:tenantSponsorId()}});
  return run?{...run,input:JSON.parse(run.input) as Evidence,result:JSON.parse(run.result) as Detection}:null;
}
