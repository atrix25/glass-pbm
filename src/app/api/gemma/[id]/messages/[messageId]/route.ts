import {z} from 'zod';
import {serviceAccess,serviceError,ServiceError} from '@/lib/service/access';
import {getClock} from '@/lib/session';
import {respond} from '@/lib/gemma/store';
export async function POST(r:Request,{params}:{params:Promise<{id:string;messageId:string}>}){try{const a=await serviceAccess(r);if((await getClock()).pinned)throw new ServiceError('Historical views are read-only.',409);const b=z.object({requestId:z.uuid(),revision:z.number().int().min(0),command:z.enum(['retry','deliver','acknowledge','fail'])}).parse(await r.json()),p=await params;return Response.json(await respond(a,p.id,p.messageId,b))}catch(e){return serviceError(e)}}
