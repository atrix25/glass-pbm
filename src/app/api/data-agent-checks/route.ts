import { NextResponse } from 'next/server';
import { z } from 'zod';
import { demoFeaturesEnabled } from '@/lib/config';
import { selectedSponsor } from '@/lib/contract-checks/context';
import { authenticatedStaff,sameOrigin } from '@/lib/contract-checks/access';
import { getClock } from '@/lib/session';
import { createCheck,nextQuestion,readCheck } from '@/lib/data-checks/service';
export const maxDuration=180;
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),key:z.uuid(),question:z.string().trim().min(1).max(1000).optional()}).strict(),
 z.object({action:z.literal('next'),id:z.string().startsWith('daq_').max(60),index:z.number().int().min(0).max(20)}).strict(),
]);
async function access(){return demoFeaturesEnabled()&&await authenticatedStaff()&&await selectedSponsor()==='wisconsin';}
export async function POST(request:Request){
 if(!sameOrigin(request)||!await access())return NextResponse.json({error:'Data checks are unavailable for this sponsor or session.'},{status:403});
 const p=schema.safeParse(await request.json().catch(()=>null));if(!p.success)return NextResponse.json({error:'Invalid request'},{status:400});
 try{const a=p.data,clock=(await getClock()).now;if(a.action==='create')return NextResponse.json({id:await createCheck(a.key,clock,a.question)});
 await nextQuestion(a.id,a.index,clock);return NextResponse.json({id:a.id});
 }catch(e){const m=e instanceof Error?e.message:'';return NextResponse.json({error:['Run unavailable','Question unavailable','Question running','Request conflict'].includes(m)?m:'Unable to complete this request.'},{status:409});}
}
export async function GET(request:Request){
 if(!await access())return NextResponse.json({error:'Unavailable'},{status:403});
 const run=await readCheck(new URL(request.url).searchParams.get('id')??'',(await getClock()).now);
 if(!run)return NextResponse.json({error:'Not found'},{status:404});
 const {lease,leaseUntil,key,...publicRun}=run;void lease;void leaseUntil;void key;
 return NextResponse.json(publicRun,{headers:{'Cache-Control':'no-store'}});
}
