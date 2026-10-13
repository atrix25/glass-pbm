// Authenticated production smoke test. Session tokens stay in memory and are never logged.
const {execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const quote=s=>"'"+s.replace(/'/g,"'\\''")+"'";
const base=process.env.SMOKE_BASE_URL||'https://glass-pbm-demo.fly.dev';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 let cookie='';if(!base.includes('localhost')){const code=`const {createHmac}=require('node:crypto');const p=Buffer.from(JSON.stringify({username:process.env.DEMO_USERNAME||'josh',expires:Date.now()+3600000})).toString('base64url');console.log(JSON.stringify({token:p+'.'+createHmac('sha256',process.env.DEMO_PASSWORD).update('glass-demo-session:v1:'+p).digest('base64url')}))`;
 const out=execFileSync('flyctl',['ssh','console','--app','glass-pbm-demo','--machine','d8d09d6f321408','-C','node -e '+quote(code)],{encoding:'utf8'});cookie='glass_demo_session='+JSON.parse(out.split('\n').find(l=>l.startsWith('{"token"'))).token;
 const unauth=await fetch(base+'/api/benefit-changes',{redirect:'manual'});assert([401,307].includes(unauth.status),'Unauthenticated API should be denied');}
 async function api(path,body){const r=await fetch(base+'/api/benefit-changes'+path,{headers:{cookie,'Content-Type':'application/json',Origin:base},...(body?{method:'POST',body:JSON.stringify(body)}:{})});const json=await r.json();if(!r.ok)throw Error(r.status+': '+json.error);return json;}
 const drugs=await api('?drugs=1&q=HUMIRA');assert(drugs.length,'Reference drug search');
 for(const kind of ['copay','pa','specialty','blocked']){
 const date=new Date().toISOString().slice(0,10),proposal={kind,copayCents:300,drugId:drugs[0].id,requiresPA:false,specialtyRestricted:false,effectiveDate:date,request:'Demonstration · '+kind};
 const created=await api('',{requestId:randomUUID(),proposal}),id=created.id;
 async function act(command,extra={}){for(let n=0;n<3;n++){const row=await api('/'+id);try{return await api('/'+id,{requestId:randomUUID(),revision:row.revision,command,...extra})}catch(e){if(n===2||!e.message.startsWith('409:'))throw e;}}}
 await act('impact');console.log('Production analysis queued',kind,id);
 const until=Date.now()+1800000;let row;for(;;){await sleep(5000);row=await api('/'+id);if(row.status==='Impact ready')break;if(row.status==='Analysis failed')throw Error(row.data.error);if(Date.now()>until)throw Error('Analysis did not complete within 30 minutes');}
 assert(row.data.impact.sampleRate===1);assert(row.data.impact.claimsEvaluated>1000000);
 await act('check');if(kind==='blocked'){row=await api('/'+id);assert.equal(row.status,'Blocked');await assert.rejects(()=>act('approve',{role:'Employer',approved:true}));console.log('Blocked example verified',id);continue;}
 await act('approve',{role:'Employer',approved:true});if(kind!=='copay')await act('approve',{role:'Clinical',approved:true});await act('version');await act('test');row=await api('/'+id);assert(row.data.tests.every(t=>t.passed));await act('deploy');
 if(kind==='copay'){
  const initial=await api('/'+id),before=initial.data.lastCheckedAt;let observed=false;for(let n=0;n<24;n++){await sleep(5000);row=await api('/'+id);if(row.data.lastCheckedAt&&row.data.lastCheckedAt!==before){observed=true;break;}}assert(observed,'Background processing should continue without a browser');console.log('Browser-independent monitoring verified',id);
 }else await act('monitor');
 await act('fault');row=await api('/'+id);assert.equal(row.status,'Discrepancy detected');await act('reprocess');row=await api('/'+id);assert(row.data.outcomes.some(x=>x.resolvedAt&&x.replacement.every(t=>t.passed)));
 const exported=await api('/'+id+'?export=1');assert(exported.data.sourceEvidence.length);assert(exported.events.some(e=>e.evidence));
 await act('rollback');row=await api('/'+id);assert.equal(row.status,'Rolled back');console.log('Production journey verified',kind,id,row.data.impact.claimsEvaluated);
 }
 console.log('Benefit changes production smoke passed.');
})().catch(e=>{console.error(e.message);process.exit(1)});
