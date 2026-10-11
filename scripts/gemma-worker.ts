import pg from 'pg';
import {prisma} from '../src/lib/db';
import {demoFeaturesEnabled} from '../src/lib/config';
import {claimNextJob,renewJobLease,completeJob,failJob} from '../src/lib/jobs';
import {deploymentScope,enqueueTick,ensureMonitor} from '../src/lib/gemma/monitor';
import {processTick} from '../src/lib/gemma/processor';
const owner='gemma-'+(process.env.FLY_MACHINE_ID??process.pid),scope=deploymentScope();
const connection=new pg.Client({connectionString:process.env.DATABASE_URL_DIRECT??process.env.DATABASE_URL??'postgresql://localhost:5432/glass'});
connection.on('error',()=>{console.error('Gemma coordinator connection lost. Stopping to preserve single-worker ownership.');process.exit(1)});
async function main(){
 if(!demoFeaturesEnabled())throw Error('Gemma requires the demo gate.');await connection.connect();
 await ensureMonitor(scope);console.log('Gemma worker ready; scheduler state is persisted.');
 for(;;){const cycleStarted=Date.now();try{
 await connection.query('BEGIN');
 // Transaction locks pin the backend safely through PgBouncer as well as direct Postgres.
 const lock=await connection.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired',[JSON.stringify(scope)]);
 if(lock.rows[0].acquired){
 await enqueueTick(scope);
 const job=await claimNextJob(owner,'gemma');if(job){const heartbeat=setInterval(()=>{void Promise.all([renewJobLease(job.id,owner),prisma.gemmaMonitor.updateMany({where:scope,data:{heartbeatAt:new Date()}})]).catch(()=>{});},30000);try{const result=await processTick(scope);await completeJob(job.id,result,owner);console.log('Gemma cycle completed',job.id);}catch(e){const message=e instanceof Error?e.message:'Cycle failed';await failJob(job.id,message,owner);await prisma.gemmaMonitor.updateMany({where:scope,data:{lastError:message}});console.error(message)}finally{clearInterval(heartbeat)}}
 }
 await connection.query('COMMIT');
 }catch(e){await connection.query('ROLLBACK').catch(()=>{});console.error(e instanceof Error?e.message:'Worker error')}
 await new Promise(r=>setTimeout(r,Math.max(1000,60000-(Date.now()-cycleStarted))));
 }
}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{void connection.end().finally(()=>process.exit(0))});
main().catch(e=>{console.error(e.message);process.exit(1)});
