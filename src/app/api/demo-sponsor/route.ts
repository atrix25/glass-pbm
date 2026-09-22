import { NextResponse } from "next/server";
import { demoFeaturesEnabled } from "@/lib/config";
import { authenticatedStaff, sameOrigin } from "@/lib/contract-checks/access";
import { SPONSOR_COOKIE } from "@/lib/contract-checks/profiles";
export async function POST(request:Request){
  if(!demoFeaturesEnabled())return NextResponse.json({error:"Demo unavailable"},{status:404});
  if(!sameOrigin(request)||!await authenticatedStaff())return NextResponse.json({error:"Access denied"},{status:403});
  const body=await request.json().catch(()=>null);
  if(!["wisconsin","tennessee"].includes(body?.sponsor))return NextResponse.json({error:"Invalid sponsor"},{status:400});
  const response=NextResponse.json({sponsor:body.sponsor});
  response.cookies.set(SPONSOR_COOKIE,body.sponsor,{httpOnly:true,sameSite:"lax",path:"/",secure:new URL(request.url).protocol==="https:",maxAge:86400*30});
  return response;
}
