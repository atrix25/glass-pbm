import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(process.cwd()+'/package.json'),{PrismaClient}=require(process.cwd()+'/src/generated/prisma/index.js'),db=new PrismaClient();
const base='http://127.0.0.1:3000',ids=[];
const headers={Authorization:'Basic '+Buffer.from((process.env.DEMO_USERNAME||'josh')+':'+(process.env.DEMO_PASSWORD||'')).toString('base64'),Cookie:'glass_demo_sponsor=tennessee',Origin:base,'Content-Type':'application/json'};
async function call(body,id,override={}){const r=await fetch(base+'/api/operating-demo'+(id?'?id='+id:''),{method:body?'POST':'GET',headers:{...headers,...override},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
try{
 const key=crypto.randomUUID(),created=await Promise.all([call({action:'create',key}),call({action:'create',key})]);for(const r of created)if(r.data.id&&!ids.includes(r.data.id))ids.push(r.data.id);assert.ok(created.every(r=>r.status===200));assert.equal(created[0].data.id,created[1].data.id);const id=ids[0];let r=(await call(null,id)).data.run;
 assert.equal((await call({action:'repair',id,key:crypto.randomUUID(),revision:0})).status,409);
 for(const action of ['scan','reject','scan','approve','repair','settle','verify']){
  const c={action,id,key:crypto.randomUUID(),revision:r.revision};const result=await call(c);assert.equal(result.status,200,JSON.stringify(result));assert.equal((await call(c)).status,200);assert.equal((await call({...c,key:crypto.randomUUID()})).status,409);r=(await call(null,id)).data.run;
  if(action==='reject')assert.equal(r.state.claims[0].memberPaid,4000);
  if(action==='repair')assert.equal((await call(null,id)).data.answers.refund.includes('pending'),true);
 }
 assert.equal(r.state.stage,'Verified');assert.equal(r.state.checks.filter(c=>c.passed).length,7);assert.equal(r.state.ledger.length,26);assert.equal(r.state.original[0].allowed,12200);assert.equal(r.state.claims[0].allowed,8000);
 assert.equal((await call(null,id,{Cookie:'glass_demo_sponsor=wisconsin'})).data.run,null);
 assert.equal((await call({action:'create',key:crypto.randomUUID()},null,{Cookie:'glass_demo_sponsor=tennessee; glass_clock=2026-10-05'})).status,409);
 assert.equal((await call({action:'create',key:crypto.randomUUID()},null,{Origin:'https://other.example'})).status,403);
 for(const view of ['overview','design','claims','work','money','service','proof']){const response=await fetch(base+'/operating-demo?view='+view,{headers});assert.equal(response.status,200);assert.ok((await response.text()).includes('A promise, kept.'));}
 console.log('PASS: complete cycle, rejection, exact results, retries, stale revisions, sponsor isolation, cutoff, origin checks and seven views.');
}finally{for(const id of ids)await db.assuranceRun.delete({where:{id}});await db.$disconnect();console.log('Disposable QA runs removed.');}
