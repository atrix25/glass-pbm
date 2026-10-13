import {importSavings} from '@/lib/benefit-changes/import';
import {access} from '@/lib/benefit-changes/access';
import {createChange,listChanges,interpretRequest} from '@/lib/benefit-changes/store';
import {serviceError} from '@/lib/service/access';
import {prisma} from '@/lib/db';
import {getClock} from '@/lib/session';
import {z} from 'zod';
export const runtime='nodejs';
export async function GET(r:Request){try{const a=await access(r),p=new URL(r.url).searchParams;
 if(p.has('savings'))return Response.json(await importSavings(a,p.get('savings')!,p.get('option')??''));
 if(p.has('drugs')){const q=(p.get('q')??'').slice(0,80);return Response.json(await prisma.drug.findMany({where:{name:{contains:q,mode:'insensitive'},formularyEntries:{some:{formularyId:'navitus-etf-2026'}}},select:{id:true,name:true,ndc11:true},take:25,orderBy:{name:'asc'}}));}
 return Response.json({...await listChanges(a,Math.max(1,Math.min(10000,Number(p.get('page'))||1)),(await getClock()).pinned),historical:(await getClock()).pinned},{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){return serviceError(e)}}
export async function POST(r:Request){try{const a=await access(r),b=await r.json();if(b.command==='interpret')return Response.json(await interpretRequest(z.string().min(3).max(3000).parse(b.request),a));z.string().uuid().parse(b.requestId);return Response.json(await createChange(a,b));}catch(e){return serviceError(e)}}
