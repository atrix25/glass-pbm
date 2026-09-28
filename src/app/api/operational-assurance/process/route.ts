import {NextResponse} from 'next/server';
import {z} from 'zod';
import {demoFeaturesEnabled} from '@/lib/config';
import {authenticatedStaff,sameOrigin} from '@/lib/contract-checks/access';
import {selectedSponsor} from '@/lib/contract-checks/context';
import {getClock,getSessionUser} from '@/lib/session';
import {createProcess,processCommand,readProcess} from '@/lib/assurance/process/service';
const base={id:z.string().startsWith('prc_').max(60),revision:z.number().int().nonnegative(),key:z.uuid()};
const step=z.enum(['contract','drugs','claims','guarantees','rates','client','manufacturer','notices']);
const link=z.object({extractionId:z.string().startsWith('ext_').max(60),extractionRevision:z.number().int().nonnegative(),requirementId:z.string().max(60),mapping:z.object({field:z.enum(['copayCents','quantityLimit','paRequired','stepRequired']),value:z.union([z.number().int().min(0).max(100000),z.boolean()]),rationale:z.string().trim().min(1).max(2000)}).strict()}).strict();
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),key:z.uuid(),scenario:z.enum(['clean','errors','missing','conflicts']).default('clean'),link:link.optional()}).strict(),
 ...(['flow','next','test'] as const).map(action=>z.object({...base,action:z.literal(action)}).strict()),
 z.object({...base,action:z.literal('review'),step,decision:z.enum(['Approved','Rejected'])}).strict(),
 z.object({...base,action:z.literal('external'),step,kind:z.enum(['acceptance','settlement','delivery'])}).strict(),
 z.object({...base,action:z.literal('execute'),step}).strict(),
 z.object({...base,action:z.literal('repair'),step}).strict(),
]);
export async function POST(request:Request){
 if(!demoFeaturesEnabled())return NextResponse.json({error:'Unavailable'},{status:404});
 if(!sameOrigin(request)||!await authenticatedStaff())return NextResponse.json({error:'Access denied'},{status:403});
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Invalid request'},{status:400});
 try{const sponsor=await selectedSponsor(),c=parsed.data;if(c.action==='create'){const user=await getSessionUser();return NextResponse.json({id:c.link?await createProcess(sponsor,c.key,c.scenario,{...c.link,actor:user?.email??'Demo reviewer · identity not recorded'}):await createProcess(sponsor,c.key,c.scenario)});}
 const user=await getSessionUser();await processCommand(sponsor,(await getClock()).now,c,user?`Simulated review · ${user.email}`:'Simulated reviewer · identity not recorded');return NextResponse.json({id:c.id});
 }catch(e){const message=e instanceof Error?e.message:'';return NextResponse.json({error:/^(Run unavailable|Evidence integrity check failed|Conflicting retry|Stale revision; refresh this run|No review pending|Approved valid draft required|Invalid evidence kind|Acceptance required before settlement|No deterministic repair available|Extraction changed; refresh before continuing|Linked flows require clean inputs|Explain the sandbox mapping|Invalid configuration value|Verified extraction required|Review the interpretation first|Resolve source citation mismatches first)$/.test(message)?message:'Unable to complete this action'},{status:409});}
}
export async function GET(request:Request){
 if(!demoFeaturesEnabled())return NextResponse.json({error:'Unavailable'},{status:404});if(!await authenticatedStaff())return NextResponse.json({error:'Access denied'},{status:403});
 const run=await readProcess(new URL(request.url).searchParams.get('id')??'',await selectedSponsor(),(await getClock()).now);return NextResponse.json(run??{error:'Not found'},{status:run?200:404,headers:{'Cache-Control':'no-store'}});
}
