import {NextResponse} from 'next/server';
import {z} from 'zod';
import {demoFeaturesEnabled} from '@/lib/config';
import {authenticatedStaff,sameOrigin} from '@/lib/contract-checks/access';
import {selectedSponsor} from '@/lib/contract-checks/context';
import {getClock,getSessionUser} from '@/lib/session';
import {createRun,readRun,reviewRun} from '@/lib/formulary-checks/service';
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),key:z.uuid()}).strict(),
 z.object({action:z.literal('review'),id:z.string().startsWith('frm_').max(60),revision:z.number().int().nonnegative(),key:z.uuid(),rowId:z.string().max(40),verdict:z.enum(['Correct','Needs correction']),note:z.string().max(2000).default('')}).strict(),
]);
const failure=(e:unknown)=>{const m=e instanceof Error?e.message:'';const allowed=['Select Tennessee','Source not available at this cutoff','Run unavailable','Row unavailable','Source or output version changed','Stale revision; refresh','Conflicting retry','Return to the current clock to review','Failed checks cannot be approved','Describe the correction needed'];return NextResponse.json({error:allowed.includes(m)?m:'Unable to complete request'},{status:409});};
export async function GET(request:Request){
 if(!demoFeaturesEnabled())return NextResponse.json({error:'Unavailable'},{status:404});if(!await authenticatedStaff())return NextResponse.json({error:'Access denied'},{status:403});
 try{return NextResponse.json({run:await readRun(await selectedSponsor(),(await getClock()).now,new URL(request.url).searchParams.get('id')??undefined)},{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}
}
export async function POST(request:Request){
 if(!demoFeaturesEnabled())return NextResponse.json({error:'Unavailable'},{status:404});if(!sameOrigin(request)||!await authenticatedStaff())return NextResponse.json({error:'Access denied'},{status:403});
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Invalid request'},{status:400});
 try{const sponsor=await selectedSponsor(),clockState=await getClock(),clock=clockState.now,c=parsed.data;
 if(clockState.pinned)throw Error('Return to the current clock to review');
 if(c.action==='create')return NextResponse.json({id:await createRun(sponsor,clock,c.key)});
 const user=await getSessionUser();await reviewRun(sponsor,clock,c,user?.email??'Demo review · Identity not recorded');return NextResponse.json({id:c.id});
 }catch(e){return failure(e);}
}
