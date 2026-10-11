import {serviceAccess,serviceError} from '@/lib/service/access';
import {getClock} from '@/lib/session';
import {overview} from '@/lib/gemma/store';
export async function GET(r:Request){try{return Response.json(await overview(await serviceAccess(r),new URL(r.url).searchParams,(await getClock()).pinned),{headers:{'Cache-Control':'private, no-store'}})}catch(e){return serviceError(e)}}
