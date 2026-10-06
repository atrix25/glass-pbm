import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(process.cwd()+'/package.json');const {PrismaClient}=require(process.cwd()+'/src/generated/prisma/index.js');const db=new PrismaClient();
const base='http://127.0.0.1:3000',ids=[];const auth='Basic '+Buffer.from((process.env.DEMO_USERNAME||'josh')+':'+(process.env.DEMO_PASSWORD||'')).toString('base64');
async function api(query='',body,cookie='glass_demo_sponsor=tennessee',origin=base){const response=await fetch(base+'/api/public-data-checks'+query,{method:body?'POST':'GET',headers:{Authorization:auth,Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
try{
 const key=crypto.randomUUID();const c=await Promise.all([api('',{action:'create',key}),api('',{action:'create',key})]);for(const result of c)if(result.data.id&&!ids.includes(result.data.id))ids.push(result.data.id);assert.equal(c[0].status,200,JSON.stringify(c));assert.equal(c[1].status,200);assert.equal(c[0].data.id,c[1].data.id);const id=c[0].data.id;let r=(await api('?id='+id)).data.run;assert.equal(r.state.stage,'Compared');assert.equal(r.changeCounts.formulary,46);
 assert.equal((await api('',{action:'verify',id,revision:0,key:crypto.randomUUID()})).status,409);
 const build={action:'build',id,revision:r.revision,key:crypto.randomUUID()};const b=await Promise.all([api('',build),api('',build)]);assert.ok(b.some(x=>x.status===200),JSON.stringify(b));assert.ok(b.every(x=>[200,409].includes(x.status)));assert.equal((await api('',build)).status,200);
 r=(await api('?id='+id)).data.run;assert.equal(r.state.stage,'Draft built');assert.equal(r.state.events.length,2);
 assert.equal((await api('',{...build,key:crypto.randomUUID()})).status,409);assert.equal((await api('',{...build,action:'verify'})).status,409);
 const verify={action:'verify',id,revision:r.revision,key:crypto.randomUUID()};assert.equal((await api('',verify)).status,200);assert.equal((await api('',verify)).status,200);
 r=(await api('?id='+id)).data.run;assert.equal(r.state.stage,'Verified');assert.equal(r.state.checks.filter(c=>c.status==='Failed').length,0);assert.equal(r.state.checks.filter(c=>c.status==='Missing evidence').length,3);assert.equal(r.state.events.length,3);
 const wrong=await api('?id='+id,undefined,'glass_demo_sponsor=wisconsin');assert.equal(wrong.status,200);assert.equal(wrong.data.run,null);
 assert.equal((await api('',{action:'create',key:crypto.randomUUID()},undefined,'https://other.example')).status,403);
 assert.equal((await api('',{action:'create',key:crypto.randomUUID()},'glass_demo_sponsor=tennessee; glass_clock=2026-10-05')).status,409);
 const price=await api('?ndc=31722055760&unit=EA&asOf=2026-08-26&effective=2026-08-26');assert.equal(price.data.row.values['NADAC Per Unit'],'0.53801');assert.equal((await api('?ndc=31722055760&unit=EA&asOf=2026-08-25&effective=2026-08-26')).data.row,null);
 const page=await api('?id='+id+'&area=network&all=1&page=2');assert.equal(page.data.page,2);assert.equal(page.data.rows.length,25);
 const evidence=await api('?id='+id+'&export=1');assert.equal(evidence.data.run.state.draft.length,63962);assert.equal(evidence.data.run.state.priceLookups.length,4849);assert.equal(evidence.data.sources.snapshots['2026-08'].length,63943);
 console.log(JSON.stringify({passed:true,changes:r.changes,checks:r.state.checks,concurrentRetry:true,sponsorIsolation:true,cutoff:true,pagination:true,export:true}));
}finally{for(const id of ids)await db.assuranceRun.delete({where:{id}});await db.$disconnect();console.log('Disposable QA runs removed.');}
