import { testInventory, COVERAGE_GAPS } from "@/lib/contract-checks/inventory";
import { evidenceAt } from "@/lib/contract-checks/detector";
import { NextResponse } from "next/server";
import { z } from "zod";
import { demoFeaturesEnabled } from "@/lib/config";
import { selectedSponsor } from "@/lib/contract-checks/context";
import { authenticatedStaff, sameOrigin } from "@/lib/contract-checks/access";
import { saveCheck, readCheck } from "@/lib/contract-checks/service";
import { getClock } from "@/lib/session";
const bodySchema=z.object({cutoff:z.iso.datetime(),key:z.uuid()}).strict();
export async function POST(request:Request){
 if(!demoFeaturesEnabled())return NextResponse.json({error:"Demo unavailable"},{status:404});
 if(!sameOrigin(request)||!await authenticatedStaff())return NextResponse.json({error:"Access denied"},{status:403});
 const parsed=bodySchema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success||Date.parse(parsed.data.cutoff)>(await getClock()).now.getTime())return NextResponse.json({error:"Invalid cutoff"},{status:400});
 try{const row=await saveCheck(await selectedSponsor(),parsed.data.cutoff,parsed.data.key);return NextResponse.json({id:row.id});}
 catch{return NextResponse.json({error:"Unable to save this check. Please retry."},{status:503});}
}
export async function GET(request:Request){
 if(!demoFeaturesEnabled())return NextResponse.json({error:"Demo unavailable"},{status:404});
 if(!await authenticatedStaff())return NextResponse.json({error:"Access denied"},{status:403});
 const run=await readCheck(new URL(request.url).searchParams.get("id")??"",await selectedSponsor());
 if(!run||run.cutoff>(await getClock()).now)return NextResponse.json({error:"Check not found at this cutoff"},{status:404});
 return NextResponse.json({...run,tests:testInventory(run.input,run.result),coverageGaps:COVERAGE_GAPS,input:evidenceAt(run.input,run.cutoff.toISOString())},{headers:{"Cache-Control":"no-store","Content-Disposition":`attachment; filename="${run.id}.json"`}});
}
