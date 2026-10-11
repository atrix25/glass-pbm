import {cookies} from 'next/headers';
import {authMode,demoFeaturesEnabled,tenantSponsorId,tenantContractId} from '@/lib/config';
import {getSessionUser,getClock} from '@/lib/session';
import {validBasicHeader,validDemoSession,DEMO_SESSION_COOKIE} from '@/lib/demo-auth';
export class ServiceError extends Error { constructor(message:string,public status=400){super(message)} }
export async function serviceAccess(request:Request){
 if(!demoFeaturesEnabled())throw new ServiceError('Member service cases are available in the demo only.',403);
 const mode=authMode();let actor='Demo reviewer';
 if(mode==='session'||mode==='oidc'){const user=await getSessionUser();if(!user)throw new ServiceError('Authentication required.',401);if(!['ops','admin','pharmacist'].includes(user.role))throw new ServiceError('Staff access required.',403);actor=user.name||user.email;}
 else if(mode==='basic'&&!validBasicHeader(request.headers.get('authorization'))&&!validDemoSession((await cookies()).get(DEMO_SESSION_COOKIE)?.value))throw new ServiceError('Authentication required.',401);
 if(request.method!=='GET'){const origin=request.headers.get('origin');if(origin&&new URL(origin).host!==(request.headers.get('x-forwarded-host')??request.headers.get('host')))throw new ServiceError('Invalid origin.',403);}
 return {sponsorId:tenantSponsorId(),contractId:tenantContractId(),actor,at:(await getClock()).now};
}
export type Access=Awaited<ReturnType<typeof serviceAccess>>;
export function serviceError(e:unknown){return Response.json({error:e instanceof Error?e.message:'Request failed.'},{status:e instanceof ServiceError?e.status:400})}
