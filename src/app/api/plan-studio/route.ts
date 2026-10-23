import {access} from '@/lib/benefit-changes/access';
import {getClock} from '@/lib/session';
import {serviceError} from '@/lib/service/access';
import {getStudy,listStudies,changeStudy} from '@/lib/plan-studio/store';
export const runtime='nodejs';
export async function GET(r:Request){try{const a=await access(r),id=new URL(r.url).searchParams.get('id');return Response.json(id?await getStudy(a,id,(await getClock()).pinned):await listStudies(a),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return serviceError(e)}}
export async function POST(r:Request){try{const a=await access(r),id=await changeStudy(a,await r.json());return Response.json(await getStudy({...a,at:new Date()},id,false));}catch(e){return serviceError(e)}}
