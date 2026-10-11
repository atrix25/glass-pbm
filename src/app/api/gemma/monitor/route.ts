import {z} from 'zod';
import {prisma} from '@/lib/db';
import {getClock} from '@/lib/session';
import {serviceAccess,serviceError,ServiceError} from '@/lib/service/access';
export async function POST(r:Request){try{const a=await serviceAccess(r);if((await getClock()).pinned)throw new ServiceError('Historical views are read-only.',409);const b=z.object({enabled:z.boolean(),revision:z.number().int().min(0)}).parse(await r.json());const where={sponsorId:a.sponsorId,contractId:a.contractId};const m=await prisma.gemmaMonitor.findFirst({where});if(!m)throw new ServiceError('Worker has not initialized.',409);if(m.enabled===b.enabled&&m.revision===b.revision+1)return Response.json({ok:true});const changed=await prisma.gemmaMonitor.updateMany({where:{...where,revision:b.revision},data:{enabled:b.enabled,revision:{increment:1}}});if(!changed.count)throw new ServiceError('Monitoring settings changed. Refresh and retry.',409);return Response.json({ok:true})}catch(e){return serviceError(e)}}
