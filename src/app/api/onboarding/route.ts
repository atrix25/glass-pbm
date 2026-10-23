import {access} from '@/lib/benefit-changes/access';
import {getClock} from '@/lib/session';
import {serviceError} from '@/lib/service/access';
import {list,detail,mutate} from '@/lib/onboarding/store';
import {ServiceError} from '@/lib/service/identity';
export const runtime='nodejs';
export async function GET(r:Request){try{const a=await access(r);if(!a.demoRoles&&!['admin','ops','plan_sponsor','pharmacist'].includes(a.role))throw new ServiceError('Employer workspace access required.',403);const historical=(await getClock()).pinned,id=new URL(r.url).searchParams.get('id');return Response.json(id?await detail(a,id,historical):await list(a,historical),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return serviceError(e)}}
export async function POST(r:Request){try{const a=await access(r),result=await mutate(a,await r.json());return Response.json(await detail({...a,at:new Date()},result.id,false));}catch(e){return serviceError(e)}}
