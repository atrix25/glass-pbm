import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {prisma} from '../src/lib/db';
import {claimNextJob,completeJob} from '../src/lib/jobs';
it('Gemma workers claim only their own tenant and fence stale owners',async()=>{
 const a={sponsorId:'queue-test-'+randomUUID(),contractId:'a'},b={sponsorId:'queue-test-'+randomUUID(),contractId:'b'},ids=[randomUUID(),randomUUID()];
 try{
 for(const [i,scope]of [a,b].entries())await prisma.job.create({data:{id:ids[i],type:'gemma-tick',payload:JSON.stringify({scope})}});
 const first=await claimNextJob('owner-a','gemma',a);expect(first?.id).toBe(ids[0]);expect(await claimNextJob('other-a','gemma',a)).toBe(null);
 const second=await claimNextJob('owner-b','gemma',b);expect(second?.id).toBe(ids[1]);await expect(completeJob(ids[0],{},'wrong-owner')).rejects.toThrow('lease lost');await completeJob(ids[0],{},'owner-a');await completeJob(ids[1],{},'owner-b');
 }finally{await prisma.jobRun.deleteMany({where:{jobId:{in:ids}}});await prisma.job.deleteMany({where:{id:{in:ids}}});}
});
