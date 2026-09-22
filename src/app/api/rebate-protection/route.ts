import { NextResponse } from "next/server";
import { z } from "zod";
import { demoFeaturesEnabled } from "@/lib/config";
import { getClock, getRole, getSessionUser } from "@/lib/session";
import { advanceSimulation, createSimulation, reviewSimulation, simulation } from "@/lib/rebate-protection/service";
import { SCENARIOS } from "@/lib/rebate-protection/scenarios";
export const runtime="nodejs";
const Action=z.discriminatedUnion("action",[
  z.object({action:z.literal("create"),scenarioId:z.enum(SCENARIOS.map(s=>s.id) as [string,...string[]]),cadence:z.enum(["Monthly","Quarterly"]),key:z.string().uuid()}).strict(),
  z.object({action:z.literal("advance"),id:z.string().startsWith("rbp_"),stage:z.number().int().min(0).max(2)}).strict(),
  z.object({action:z.literal("review"),id:z.string().startsWith("rbp_"),decision:z.enum(["Approved","Rejected"])}).strict(),
]);
export async function GET(request:Request){
  if(!demoFeaturesEnabled())return NextResponse.json({error:"Demo unavailable"},{status:404});
  const url=new URL(request.url), id=url.searchParams.get("id"),cutoff=url.searchParams.get("cutoff")??undefined;
  if(!id||cutoff&&!Number.isFinite(Date.parse(cutoff)))return NextResponse.json({error:"Invalid run or cutoff"},{status:400});
  const data=await simulation(id,(await getClock()).now,cutoff);
  return NextResponse.json(data??{error:"Simulation not found"},{status:data?200:404});
}
export async function POST(request:Request){
  if(!demoFeaturesEnabled())return NextResponse.json({error:"Demo unavailable"},{status:404});
  const origin=request.headers.get("origin"),host=request.headers.get("x-forwarded-host")??request.headers.get("host")??new URL(request.url).host;
  try{if(!origin||new URL(origin).host!==host)return NextResponse.json({error:"Invalid origin"},{status:403});}catch{return NextResponse.json({error:"Invalid origin"},{status:403});}
  if(!["admin","sponsor"].includes(await getRole()))return NextResponse.json({error:"Staff role required"},{status:403});
  const parsed=Action.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:"Invalid simulation request"},{status:400});
  const action=parsed.data,clock=(await getClock()).now;
  try{
    let id:string;
    if(action.action==="create")id=await createSimulation(action.scenarioId,action.cadence,action.key,clock);
    else {id=action.id;
      if(action.action==="advance")await advanceSimulation(id,action.stage,clock);
      else {const user=await getSessionUser();await reviewSimulation(id,action.decision,user?.email??"Simulated Finance reviewer",clock);}
    }
    return NextResponse.json({id});
  }catch(error){
    const message=error instanceof Error?error.message:"Simulation failed";
    const allowed=/^(Request key|Simulation not found|Refresh this|Record a simulated|This step|A different simulated|No simulated review|Review is after|Unknown scenario)/.test(message);
    return NextResponse.json({error:allowed?message:"The sandbox is unavailable. Try again."},{status:allowed?409:503});
  }
}
