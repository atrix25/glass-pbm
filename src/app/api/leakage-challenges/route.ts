import { NextResponse } from 'next/server';
import { z } from 'zod';
import { demoFeaturesEnabled } from '@/lib/config';
import { selectedSponsor } from '@/lib/contract-checks/context';
import { authenticatedStaff,sameOrigin } from '@/lib/contract-checks/access';
import { getClock } from '@/lib/session';
import { createChallenge,evaluateChallenge,readChallenge } from '@/lib/leakage-challenge/service';
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),key:z.uuid(),size:z.union([z.literal(200),z.literal(1000)])}).strict(),
 z.object({action:z.literal('evaluate'),id:z.string().startsWith('lch_').max(60)}).strict(),
]);
export async function POST(request:Request){
 if(!demoFeaturesEnabled())return NextResponse.json({error:'Demo unavailable'},{status:404});
 if(!sameOrigin(request)||!await authenticatedStaff())return NextResponse.json({error:'Access denied'},{status:403});
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Invalid challenge request'},{status:400});
 const sponsor=await selectedSponsor(),clock=(await getClock()).now;
 try{
  const a=parsed.data;
  if(a.action==='create')return NextResponse.json({id:await createChallenge(sponsor,a.key,a.size)});
  await evaluateChallenge(a.id,sponsor,clock);return NextResponse.json({id:a.id});
 }catch(error){const message=error instanceof Error?error.message:'';return NextResponse.json({error:['Challenge unavailable','Request key has different inputs','Evidence integrity check failed'].includes(message)?message:'Unable to run this challenge. Please retry.'},{status:message==='Challenge unavailable'?404:409});}
}
export async function GET(request:Request){
 if(!demoFeaturesEnabled())return NextResponse.json({error:'Demo unavailable'},{status:404});
 if(!await authenticatedStaff())return NextResponse.json({error:'Access denied'},{status:403});
 const run=await readChallenge(new URL(request.url).searchParams.get('id')??'',await selectedSponsor(),(await getClock()).now);
 return NextResponse.json(run??{error:'Challenge not found'},{status:run?200:404,headers:{'Cache-Control':'no-store'}});
}
