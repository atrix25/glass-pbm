import {z} from 'zod';
import {serviceAccess,serviceError} from '@/lib/service/access';
import {getCase,act} from '@/lib/service/store';
import {askCase} from '@/lib/service/conversation';
import {COMMANDS} from '@/lib/service/state';
export const runtime='nodejs';
export const maxDuration=90;
const schema=z.discriminatedUnion('type',[
 z.object({type:z.literal('question'),requestId:z.uuid(),revision:z.number().int().nonnegative(),question:z.string().trim().min(1).max(2000)}),
 z.object({type:z.literal('action'),requestId:z.uuid(),revision:z.number().int().nonnegative(),command:z.enum(COMMANDS),note:z.string().trim().max(2000).default('')})
]);
export async function GET(request:Request,ctx:{params:Promise<{id:string}>}){try{return Response.json(await getCase(await serviceAccess(request),(await ctx.params).id),{headers:{'Cache-Control':'private, no-store'}})}catch(e){return serviceError(e)}}
export async function POST(request:Request,ctx:{params:Promise<{id:string}>}){try{const a=await serviceAccess(request),{id}=await ctx.params,b=schema.parse(await request.json());return Response.json(b.type==='question'?await askCase(a,id,b):await act(a,id,b))}catch(e){return serviceError(e)}}
