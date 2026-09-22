import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { tenantSponsorId } from "@/lib/config";
import { comparison, day, DAYS, OWNER, type Cadence, type Event, type Snapshot } from "./model";
import { eventsForStage, fixture } from "./scenarios";

function dbEvent(runId: string, e: Event) {
  return {...e,runId,serviceAt:new Date(e.serviceAt),recordedAt:new Date(e.recordedAt),settledAt:e.settledAt?new Date(e.settledAt):null};
}
export async function createSimulation(scenarioId:string,cadence:Cadence,key:string,clock:Date) {
  const tenantId=tenantSponsorId();
  const unique=createHash("sha256").update(`${tenantId}:${key}`).digest("hex");
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(74839211)::text`;
    const existing=await tx.rebateSandboxRun.findUnique({where:{key:unique}});
    if(existing){
      const snapshot=JSON.parse(existing.snapshot) as Snapshot;
      if(existing.scenarioId!==scenarioId||snapshot.cadence!==cadence)throw Error("Request key already used with different inputs.");
      return existing.id;
    }
    const id=`rbp_${randomUUID()}`;
    const s=fixture(scenarioId,day(clock.toISOString(),-120),cadence);
    await tx.rebateSandboxRun.create({data:{id,key:unique,tenantId,scenarioId,snapshot:JSON.stringify(s)}});
    await tx.rebateSandboxEvent.createMany({data:eventsForStage(id,s,0,null).map(e=>dbEvent(id,e))});
    if(s.scenario.id!=="timing")await tx.rebateSandboxException.create({data:{id:`${id}:exception`,runId:id,owner:OWNER,reason:s.scenario.cause,amountCents:s.scenario.id==="eligibility"?20000:s.scenario.id==="unfavorable"?40000:s.scenario.extraCreditCents||s.scenario.failedClaims*10000,dueAt:new Date(day(s.anchor,80)),evidence:JSON.stringify({claimIds:s.claims.map(c=>c.id),termIds:s.terms.map(t=>t.id),forecast:s.forecast,control:s.scenario.control})}});
    return id;
  });
}
export async function advanceSimulation(id:string,expectedStage:number,clock:Date) {
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(74839211)::text`;
    const run=await tx.rebateSandboxRun.findFirst({where:{id,tenantId:tenantSponsorId()}});
    if(!run)throw Error("Simulation not found.");
    if(run.stage>expectedStage)return; // Repeated transition is a no-op.
    if(run.stage!==expectedStage||run.stage>=3)throw Error("Refresh this simulation before continuing.");
    const s=JSON.parse(run.snapshot) as Snapshot;
    if(run.stage===1&&s.scenario.review&&!run.decision)throw Error("Record a simulated review before advancing.");
    const next=run.stage+1;
    if(new Date(day(s.anchor,DAYS[next]))>clock)throw Error("This step is after the selected clock cutoff.");
    await tx.rebateSandboxEvent.createMany({data:eventsForStage(id,s,next,run.decision).map(e=>dbEvent(id,e))});
    await tx.rebateSandboxRun.update({where:{id},data:{stage:next}});
  });
}
export async function reviewSimulation(id:string,decision:"Approved"|"Rejected",actor:string,clock:Date) {
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(74839211)::text`;
    const run=await tx.rebateSandboxRun.findFirst({where:{id,tenantId:tenantSponsorId()}});
    if(!run)throw Error("Simulation not found.");
    const s=JSON.parse(run.snapshot) as Snapshot;
    if(run.decision){if(run.decision!==decision)throw Error("A different simulated decision is already recorded.");return;}
    if(run.stage!==1||!s.scenario.review)throw Error("No simulated review is awaiting a decision.");
    const at=day(s.anchor,80);
    if(new Date(at)>clock)throw Error("Review is after the selected clock cutoff.");
    await tx.rebateSandboxRun.update({where:{id},data:{decision,reviewer:actor,reviewedAt:new Date(at)}});
    await tx.rebateSandboxEvent.create({data:dbEvent(id,{id:`${id}:review`,path:"Agent",kind:"Simulated review",claimId:null,termId:null,evidenceId:`${id}:exception`,amountCents:0,serviceAt:s.anchor,recordedAt:at,settledAt:null,detail:`${decision} by ${actor}. ${s.scenario.review}. Sandbox decision only; no operational authorization.`})});
  });
}
export async function simulation(id:string,clock:Date,requestedCutoff?:string) {
  const run=await prisma.rebateSandboxRun.findFirst({where:{id,tenantId:tenantSponsorId()},include:{events:{orderBy:[{recordedAt:"asc"},{id:"asc"}]},exceptions:true}});
  if(!run)return null;
  const snapshot=JSON.parse(run.snapshot) as Snapshot;
  // Refresh display copy in older sandbox records without modifying frozen financial data.
  const displayCitation = "Synthetic rebate exhibit v1 · not actual contract terms";
  snapshot.terms = snapshot.terms.map(term => ({...term, citation: term.citation.startsWith("Synthetic rebate exhibit v1 ·") ? displayCitation : term.citation}));
  const current=run.reviewedAt&&run.stage===1?run.reviewedAt.toISOString():day(snapshot.anchor,DAYS[run.stage]);
  const cutoff=new Date(Math.min(clock.getTime(),Date.parse(current),requestedCutoff?Date.parse(requestedCutoff):Infinity)).toISOString();
  const visible=run.events.filter(e=>e.recordedAt<=new Date(cutoff)).map(e=>({...e,detail:e.detail.replace(/Synthetic rebate exhibit v1 · not [^.]+ contract terms/g,displayCitation),path:e.path as Event["path"],serviceAt:e.serviceAt.toISOString(),recordedAt:e.recordedAt.toISOString(),settledAt:e.settledAt?.toISOString()??null,createdAt:e.createdAt.toISOString()}));
  const reviewVisible=run.reviewedAt&&run.reviewedAt<=new Date(cutoff);
  const viewStage=DAYS.reduce((a,n,i)=>day(snapshot.anchor,n)<=cutoff?i:a,-1);
  return {id:run.id,scenarioId:run.scenarioId,snapshot,cutoff,stage:viewStage,currentStage:run.stage,
    historical:cutoff<current,decision:reviewVisible?run.decision:null,reviewer:reviewVisible?run.reviewer:null,
    events:visible,exceptions:day(snapshot.anchor,60)<=cutoff?run.exceptions.map(e=>({...e,dueAt:e.dueAt.toISOString()})):[],
    result:comparison(snapshot,visible,cutoff),createdAt:run.createdAt.toISOString()};
}
export type Simulation = NonNullable<Awaited<ReturnType<typeof simulation>>>;
export async function recentSimulations() {
  return prisma.rebateSandboxRun.findMany({where:{tenantId:tenantSponsorId()},orderBy:{createdAt:"desc"},take:20,select:{id:true,scenarioId:true,createdAt:true}});
}
