import {NextResponse} from 'next/server';
import {demoFeaturesEnabled} from '@/lib/config';
import {authenticatedStaff,sameOrigin} from '@/lib/contract-checks/access';
import {selectedSponsor} from '@/lib/contract-checks/context';
import {getClock} from '@/lib/session';
import {runReferenceChecks} from '@/lib/drug-reference-checks/run';
export async function POST(request:Request){
 if(!demoFeaturesEnabled())return NextResponse.json({error:'Unavailable'},{status:404});
 if(!sameOrigin(request)||!await authenticatedStaff())return NextResponse.json({error:'Access denied'},{status:403});
 try{const result=runReferenceChecks(await selectedSponsor(),(await getClock()).now);return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Unable to run checks'},{status:409});}
}
