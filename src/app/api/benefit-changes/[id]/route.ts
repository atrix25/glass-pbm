import {access} from '@/lib/benefit-changes/access';
import {getChange,command} from '@/lib/benefit-changes/store';
import {serviceError} from '@/lib/service/access';
import {getClock} from '@/lib/session';
import {z} from 'zod';
export const runtime='nodejs';
export async function GET(r:Request,{params}:{params:Promise<{id:string}>}){try{const result=await getChange(await access(r),(await params).id,(await getClock()).pinned,new URL(r.url).searchParams.has('export'),Math.max(0,Number(new URL(r.url).searchParams.get('membersPage'))||0),new URL(r.url).searchParams.has('claims'));return Response.json(result,{headers:{'Cache-Control':'private, no-store',...(new URL(r.url).searchParams.has('export')?{'Content-Disposition':`attachment; filename="benefit-change.json"`}:{})}});}catch(e){return serviceError(e)}}
export async function POST(r:Request,{params}:{params:Promise<{id:string}>}){try{const a=await access(r),b=await r.json();z.string().min(1).max(120).parse(b.requestId);z.number().int().min(0).parse(b.revision);return Response.json(await command(a,(await params).id,b));}catch(e){return serviceError(e)}}
