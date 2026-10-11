import {z} from 'zod';
import {serviceAccess,serviceError} from '@/lib/service/access';
import {createCase,listCases,getOutcomes} from '@/lib/service/store';
export const runtime='nodejs';
const schema=z.object({requestId:z.uuid(),memberId:z.string().min(1).max(100),kind:z.enum(['cost','authorization','benefit']),claimId:z.string().max(100).optional(),runId:z.string().max(100).optional(),optionId:z.string().max(100).optional()}).refine(x=>!!x.runId===!!x.optionId,'Savings run and option must be provided together.');
export async function GET(request:Request){try{const a=await serviceAccess(request),p=new URL(request.url).searchParams;return Response.json(p.get('view')==='outcomes'?await getOutcomes(a):await listCases(a,p),{headers:{'Cache-Control':'private, no-store'}})}catch(e){return serviceError(e)}}
export async function POST(request:Request){try{const a=await serviceAccess(request),input=schema.parse(await request.json());return Response.json({id:await createCase(a,input)},{status:201})}catch(e){return serviceError(e)}}
