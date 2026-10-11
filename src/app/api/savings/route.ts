import {NextResponse} from 'next/server';
import {prisma} from '@/lib/db';
import {getClock} from '@/lib/session';
import {demoFeaturesEnabled,tenantSponsorId,tenantContractId} from '@/lib/config';
import {DEFAULT_GOALS,type Goals} from '@/lib/savings/types';
export const runtime='nodejs';
export async function POST(request:Request){
 if(!demoFeaturesEnabled())return NextResponse.json({error:'Demo only'},{status:403});
 try { if(request.headers.get('origin')&&new URL(request.headers.get('origin')!).host!==(request.headers.get('x-forwarded-host')??request.headers.get('host')))return NextResponse.json({error:'Invalid origin'},{status:403}); } catch { return NextResponse.json({error:'Invalid origin'},{status:400}); }
 let body;try{body=await request.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400})}
 if(!body||typeof body.requestId!=='string'||!/^\w{8}-[\w-]{27,40}$/.test(body.requestId))return NextResponse.json({error:'Request ID required'},{status:400});
 const g=body.goals??DEFAULT_GOALS;
 for(const key of ['savingsPercent','maxDisruptedPercent','maxNpsLoss'])if(typeof g[key]!=='number'||!Number.isFinite(g[key])||g[key]<0||g[key]>100)return NextResponse.json({error:'Goals must be between 0 and 100'},{status:400});
 if(typeof g.allowHigherCost!=='boolean')return NextResponse.json({error:'Member cost preference required'},{status:400});
 const goals:Goals={savingsPercent:g.savingsPercent,maxDisruptedPercent:g.maxDisruptedPercent,maxNpsLoss:g.maxNpsLoss,allowHigherCost:g.allowHigherCost};
 const clock=await getClock();
 const payload=JSON.stringify({cutoff:clock.today.toISOString(),goals,sponsor:tenantSponsorId(),contract:tenantContractId()});
 const id='sav_'+body.requestId;
 const job=await prisma.job.upsert({where:{id},create:{id,type:'savings-v1',payload,maxAttempts:1,status:'pending'},update:{}});
 if(job.payload!==payload||job.type!=='savings-v1')return NextResponse.json({error:'Request ID already used for different inputs'},{status:409});
 return NextResponse.json({id,status:job.status},{status:202});
}
export async function GET(request:Request){
 if(!demoFeaturesEnabled())return NextResponse.json({error:'Demo only'},{status:403});
 const id=new URL(request.url).searchParams.get('id');
 if(!id?.startsWith('sav_'))return NextResponse.json({error:'Run ID required'},{status:400});
 const job=await prisma.job.findUnique({where:{id}});
 if(!job||job.type!=='savings-v1')return NextResponse.json({error:'Run not found'},{status:404});
 const payload=JSON.parse(job.payload);
 if(payload.sponsor!==tenantSponsorId()||payload.contract!==tenantContractId())return NextResponse.json({error:'Run not found'},{status:404});
 return NextResponse.json({id,status:job.status,progress:job.progress,error:job.error,result:job.result?JSON.parse(job.result):null},{headers:{'Cache-Control':'private, no-store'}});
}
