import {after,NextResponse} from 'next/server';
import {z} from 'zod';
import {demoFeaturesEnabled} from '@/lib/config';
import {authenticatedStaff,sameOrigin} from '@/lib/contract-checks/access';
import {selectedSponsor} from '@/lib/contract-checks/context';
import {getSessionUser} from '@/lib/session';
import {createExtraction,executeExtraction,readExtraction,reviewExtraction} from '@/lib/contract-extraction/service';
export const maxDuration=300;
const common={id:z.string().startsWith('ext_').max(60),revision:z.number().int().nonnegative(),key:z.uuid()};
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),key:z.uuid()}).strict(),
 z.object({...common,action:z.literal('review'),requirementId:z.string().max(60),verdict:z.enum(['Correct','Corrected','Unsupported','Unverifiable','Duplicate']),correction:z.string().max(5000).default(''),note:z.string().max(3000).default('')}).strict(),
 z.object({...common,action:z.literal('omission'),page:z.number().int(),quote:z.string().min(10).max(4000),interpretation:z.string().min(1).max(3000)}).strict(),
 z.object({...common,action:z.literal('page'),page:z.number().int()}).strict(),
 z.object({...common,action:z.literal('retry')}).strict(),
]);
export async function POST(request:Request){
 if(!demoFeaturesEnabled())return NextResponse.json({error:'Unavailable'},{status:404});if(!sameOrigin(request)||!await authenticatedStaff())return NextResponse.json({error:'Access denied'},{status:403});
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Invalid request'},{status:400});
 try{const sponsor=await selectedSponsor(),c=parsed.data;if(c.action==='create'){const id=await createExtraction(sponsor,c.key);after(()=>executeExtraction(id,sponsor));return NextResponse.json({id});}
 const user=await getSessionUser();await reviewExtraction(sponsor,c,user?user.email:'Demo reviewer · identity not recorded');if(c.action==='retry')after(()=>executeExtraction(c.id,sponsor));return NextResponse.json({id:c.id});
 }catch(e){const m=e instanceof Error?e.message:'';const allowed=['Model connection required','Extraction is not retryable','Model extraction is not complete','Original extraction integrity check failed','Requirement unavailable','A correct answer requires matching source quotations','Enter the corrected interpretation','Omission must quote a supplied source page','Page unavailable','Run unavailable','Source integrity check failed','Conflicting retry','Stale revision; refresh this run'];return NextResponse.json({error:allowed.includes(m)?m:'Unable to save extraction review'},{status:409});}
}
export async function GET(request:Request){if(!demoFeaturesEnabled())return NextResponse.json({error:'Unavailable'},{status:404});if(!await authenticatedStaff())return NextResponse.json({error:'Access denied'},{status:403});const run=await readExtraction(new URL(request.url).searchParams.get('id')??'',await selectedSponsor());return NextResponse.json(run??{error:'Not found'},{status:run?200:404,headers:{'Cache-Control':'no-store'}});}
