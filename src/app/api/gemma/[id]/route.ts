import {z} from 'zod';
import {serviceAccess,serviceError,ServiceError} from '@/lib/service/access';
import {getClock} from '@/lib/session';
import {detail,review} from '@/lib/gemma/store';
const input=z.object({requestId:z.uuid(),revision:z.number().int().min(0),proposalHash:z.string().length(64),decision:z.enum(['Approve','Reject']),note:z.string().max(1000).default('')});
export async function GET(r:Request,{params}:{params:Promise<{id:string}>}){try{return Response.json(await detail(await serviceAccess(r),(await params).id,new URL(r.url).searchParams,(await getClock()).pinned),{headers:{'Cache-Control':'private, no-store'}})}catch(e){return serviceError(e)}}
export async function POST(r:Request,{params}:{params:Promise<{id:string}>}){try{const a=await serviceAccess(r);if((await getClock()).pinned)throw new ServiceError('Historical views are read-only.',409);return Response.json(await review(a,(await params).id,input.parse(await r.json())))}catch(e){return serviceError(e)}}
