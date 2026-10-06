import {NextResponse} from 'next/server';
import {z} from 'zod';
import {demoFeaturesEnabled} from '@/lib/config';
import {authenticatedStaff,sameOrigin} from '@/lib/contract-checks/access';
import {selectedSponsor} from '@/lib/contract-checks/context';
import {getClock} from '@/lib/session';
import {createRun,readRun,advance} from '@/lib/public-data-checks/service';
import {dataset,manifest,assertCutoff} from '@/lib/public-data-checks/data';
import {priceAt} from '@/lib/public-data-checks/processor';
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),key:z.uuid()}).strict(),
 z.object({action:z.enum(['build','verify']),id:z.string().startsWith('pub_').max(60),key:z.uuid(),revision:z.number().int().nonnegative()}).strict(),
]);
const fail=(e:unknown)=>{const message=e instanceof Error?e.message:'';const known=['Sources unavailable at this cutoff','Run version unavailable','Run updated after this cutoff','Run unavailable','Conflicting retry','Stale revision; refresh','Step already completed','Build the draft first','Return to the current clock'];return NextResponse.json({error:known.includes(message)?message:'Unable to complete request'},{status:409});};
export async function GET(request:Request){
 if(!demoFeaturesEnabled())return NextResponse.json({error:'Unavailable'},{status:404});if(!await authenticatedStaff())return NextResponse.json({error:'Access denied'},{status:403});
 try{
 const clock=await getClock();assertCutoff(clock.now);const q=new URL(request.url).searchParams,data=dataset();
 const run=await readRun(await selectedSponsor(),clock.now,q.get('id')??undefined);
 if(q.get('export')==='1')return NextResponse.json({manifest,run,sources:data},{headers:{'Cache-Control':'no-store','Content-Disposition':'attachment; filename="public-data-evidence.json"'}});
 if(q.has('ndc')){
  const ndc=q.get('ndc')!,unit=q.get('unit')??'EA',asOf=q.get('asOf')??'2026-09-30',effective=q.get('effective')??asOf;
  if(!/^\d{11}$/.test(ndc)||![asOf,effective].every(v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v&&v<=clock.now.toISOString().slice(0,10)))return NextResponse.json({error:'Use an 11-digit NDC and dates no later than the clock cutoff'},{status:400});
  return NextResponse.json({row:priceAt(data.prices,ndc,unit,asOf,effective),history:data.prices.filter(r=>r.values.NDC===ndc),scope:'Only the two imported weekly snapshots are available.'},{headers:{'Cache-Control':'no-store'}});
 }
 const area=q.get('area')??'formulary',all=q.get('all')==='1',search=(q.get('q')??'').slice(0,100).toLowerCase();
 const before=new Map(data.snapshots['2026-08'].map(r=>[r.id,r])),after=new Map(data.snapshots['2026-09'].map(r=>[r.id,r])),draft=new Map(run?.state.draft?.map(r=>[r.id,r])??[]);
 const changes=new Map(run?.state.changes.map(r=>[r.id,r])??[]);
 const rows=area==='prices'?data.prices.map(r=>({id:r.id,area:r.area,before:null,after:r,produced:null,kind:'Published'})):[...new Set([...before.keys(),...after.keys()])].filter(id=>(after.get(id)??before.get(id))?.area===area&&(all||changes.has(id))).map(id=>({id,area,before:before.get(id)??null,after:after.get(id)??null,produced:draft.get(id)??null,kind:changes.get(id)?.kind??'Unchanged'}));
 const filtered=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(search)),pages=Math.max(1,Math.ceil(filtered.length/25)),page=Math.min(pages,Math.max(1,Math.floor(Number(q.get('page')))||1));
 return NextResponse.json({manifest,run:run?{...run,state:{...run.state,draft:undefined,changes:undefined,priceLookups:undefined},changeCounts:run.state.changes.reduce<Record<string,number>>((a,c)=>(a[c.area]=(a[c.area]??0)+1,a),{}),changes:run.state.changes.length}:null,rows:filtered.slice((page-1)*25,page*25),total:filtered.length,page,pages},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return fail(e);}
}
export async function POST(request:Request){
 if(!demoFeaturesEnabled())return NextResponse.json({error:'Unavailable'},{status:404});if(!sameOrigin(request)||!await authenticatedStaff())return NextResponse.json({error:'Access denied'},{status:403});
 const parsed=command.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Invalid request'},{status:400});
 try{const clock=await getClock();assertCutoff(clock.now);if(clock.pinned)throw Error('Return to the current clock');const sponsor=await selectedSponsor(),c=parsed.data;
 if(c.action==='create')return NextResponse.json({id:await createRun(sponsor,clock.now,c.key)});
 await advance(sponsor,c);return NextResponse.json({id:c.id});
 }catch(e){return fail(e);}
}
