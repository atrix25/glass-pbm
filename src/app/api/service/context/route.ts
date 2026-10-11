import {serviceAccess,serviceError} from '@/lib/service/access';
import {memberContext,savingsSource} from '@/lib/service/store';
export const runtime='nodejs';
export async function GET(request:Request){try{const a=await serviceAccess(request),p=new URL(request.url).searchParams;
 if(p.get('run')&&p.get('option')){const o=await savingsSource(a,p.get('run')!,p.get('option')!);const page=Math.max(1,Number(p.get('page'))||1);return Response.json({title:o.title,total:o.disruptions.length,members:o.disruptions.slice((page-1)*25,page*25),page},{headers:{'Cache-Control':'private, no-store'}})}
 const {member,claims}=await memberContext(a,p.get('member')??'',p.get('claim')??undefined);return Response.json({member,claims:claims.map(c=>({id:c.id,number:c.claimNumber,drug:c.drug.name,status:c.responseStatus,date:c.dateOfService,memberPaid:c.patientPayCents,reject:c.rejectMessage,plan:c.benefitPlan.name}))},{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){return serviceError(e)}}
