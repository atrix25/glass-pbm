const assert=require('node:assert/strict');
const base=process.env.GLASS_BASE_URL||'http://127.0.0.1:3000';
const headers=process.env.DEMO_PASSWORD?{authorization:'Basic '+Buffer.from((process.env.DEMO_USERNAME||'josh')+':'+process.env.DEMO_PASSWORD).toString('base64')}:{};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(path,body){const r=await fetch(base+'/api/gemma'+path,{headers:{...headers,'content-type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Error(r.status+' '+(d.error||'Request failed'));return d;}
(async()=>{
 let summary=await api('');assert(summary.monitor.population===103380);assert(summary.monitor.claims>=1620000);
 if(headers.authorization){const denied=await fetch(base+'/api/gemma');assert.equal(denied.status,401);}
 console.log('Production page/API and full reference population verified.');
 if(!summary.monitor.enabled)await api('/monitor',{enabled:true,revision:summary.monitor.revision});
 const selected={},complete=new Set(),startScanned=summary.monitor.scanned,deadline=Date.now()+12*60000;
 while(Date.now()<deadline&&complete.size<3){
 for(const kind of ['access','external','savings']){
 if(complete.has(kind))continue;
 if(!selected[kind]){const list=await api('?kind='+kind);const candidate=list.rows.find(w=>w.status==='Verified')||list.rows.find(w=>w.status==='Awaiting approval');if(candidate)selected[kind]=candidate.id;}
 if(!selected[kind])continue;
 let w=await api('/'+selected[kind]);
 if(w.status==='Awaiting approval'){try{await api('/'+w.id,{requestId:crypto.randomUUID(),revision:w.revision,proposalHash:w.proposalHash,decision:'Approve',note:'Production smoke test: approve this sandbox version only.'});console.log(kind,'review recorded',w.id)}catch(e){console.log(kind,'review blocked',e.message);delete selected[kind];continue;}}
 if(['Failed','Blocked','Rejected'].includes(w.status)){console.log(kind,w.status,JSON.stringify(w.data.error||w.data.validation||'No valid recommendation'));if(kind==='savings')throw Error('Savings did not complete');delete selected[kind];continue;}
 if(w.status==='Applied'){
 for(const m of w.messages){let command=m.status==='Failed'?'retry':m.status==='Sent'?'deliver':m.status==='Delivered'?'acknowledge':null;if(!command)continue;w=await api('/'+w.id);await api('/'+w.id+'/messages/'+m.id,{requestId:crypto.randomUUID(),revision:w.revision,command});}
 }
 if(w.status==='Verified'){complete.add(kind);console.log(kind,'VERIFIED',w.id);const agent=w.activities.find(a=>a.runId);assert(agent);const r=await fetch(base+'/agents/runs/'+agent.runId,{headers});assert.equal(r.status,200);}
 }
 summary=await api('');console.log('Worker',summary.monitor.health,'scanned',summary.monitor.scanned,'verified journeys',complete.size);if(complete.size<3)await sleep(20000);
 }
 assert.equal(complete.size,3,'All three journeys must finish');if(summary.monitor.scanned<=startScanned){await sleep(65000);summary=await api('');}assert(summary.monitor.scanned>startScanned,'Background cursor must advance without a browser');assert.equal(summary.monitor.health,'Monitoring');console.log('PASS: three production journeys; browser-independent worker; isolated simulated approvals and communications. Scheduler remains enabled.');
})().catch(e=>{console.error(e);process.exitCode=1});
