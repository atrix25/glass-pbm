import {NextResponse} from 'next/server';
import {z} from 'zod';
import {demoFeaturesEnabled} from '@/lib/config';
import {authenticatedStaff,sameOrigin} from '@/lib/contract-checks/access';
import {selectedSponsor} from '@/lib/contract-checks/context';
import {getClock,getSessionUser} from '@/lib/session';
import {act,createAssurance,readAssurance} from '@/lib/assurance/service';
const id=z.string().startsWith('oas_').max(60),revision=z.number().int().min(0),patchId=z.string().max(150);
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),key:z.uuid()}).strict(),
 z.object({action:z.literal('run'),id,revision}).strict(),
 z.object({action:z.literal('review'),id,revision,patchId,decision:z.enum(['Approved','Rejected'])}).strict(),
 z.object({action:z.literal('external'),id,revision,patchId}).strict(),
]);
export async function POST(request:Request){
 if(!demoFeaturesEnabled())return NextResponse.json({error:'Unavailable'},{status:404});
 if(!sameOrigin(request)||!await authenticatedStaff())return NextResponse.json({error:'Access denied'},{status:403});
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Invalid request'},{status:400});
 try{
  const sponsor=await selectedSponsor(),c=parsed.data;
  if(c.action==='create')return NextResponse.json({id:await createAssurance(sponsor,c.key)});
  const user=await getSessionUser();await act(sponsor,(await getClock()).now,c,user?`Simulated review · ${user.email}`:'Simulated demo reviewer · individual identity not recorded');return NextResponse.json({id:c.id});
 }catch(e){const m=e instanceof Error?e.message:'';return NextResponse.json({error:['Run unavailable','Stale revision; refresh this run','Conflicting decision','Correction rejected','Stale correction','No review pending','Approved draft required','Expired obligation cannot be repaired','Evidence integrity check failed'].includes(m)?m:'Unable to complete this action.'},{status:409});}
}
export async function GET(request:Request){
 if(!demoFeaturesEnabled())return NextResponse.json({error:'Unavailable'},{status:404});if(!await authenticatedStaff())return NextResponse.json({error:'Access denied'},{status:403});
 const run=await readAssurance(new URL(request.url).searchParams.get('id')??'',await selectedSponsor(),(await getClock()).now);return NextResponse.json(run??{error:'Not found'},{status:run?200:404,headers:{'Cache-Control':'no-store'}});
}
