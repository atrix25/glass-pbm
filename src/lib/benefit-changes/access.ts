import {cookies} from 'next/headers';
import {authMode,demoFeaturesEnabled,tenantSponsorId,tenantContractId} from '@/lib/config';
import {getSessionUser,getClock} from '@/lib/session';
import {validBasicHeader,validDemoSession,DEMO_SESSION_COOKIE} from '@/lib/demo-auth';
import {ServiceError} from '@/lib/service/identity';
import type {ChangeAccess} from './store';
export async function access(request:Request):Promise<ChangeAccess>{
 if(!demoFeaturesEnabled())throw new ServiceError('Benefit changes are available in the demo only.',403);
 const mode=authMode(),clock=await getClock();let actor='Demo reviewer',role='admin';
 if(mode==='session'||mode==='oidc'){const user=await getSessionUser();if(!user)throw new ServiceError('Authentication required.',401);actor=user.name||user.email;role=user.role;if(request.method!=='GET'&&role==='readonly')throw new ServiceError('Read-only access.',403);}
 else if(mode==='basic'&&!validBasicHeader(request.headers.get('authorization'))&&!validDemoSession((await cookies()).get(DEMO_SESSION_COOKIE)?.value))throw new ServiceError('Authentication required.',401);
 if(request.method!=='GET'){if(clock.pinned)throw new ServiceError('Historical views are read-only.',409);const origin=request.headers.get('origin');if(origin&&new URL(origin).host!==(request.headers.get('x-forwarded-host')??request.headers.get('host')))throw new ServiceError('Invalid origin.',403);}
 return {actor,role,demoRoles:mode==='basic'||mode==='open',sponsorId:tenantSponsorId(),contractId:tenantContractId(),at:clock.now};
}
