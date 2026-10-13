import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {prisma} from '../src/lib/db';
import {command,getChange,listChanges,type ChangeAccess} from '../src/lib/benefit-changes/store';
import {simulateClaims,reprocessBatch} from '../src/lib/benefit-changes/monitor';
import type {ChangeData} from '../src/lib/benefit-changes/types';
async function main(){const a:ChangeAccess={sponsorId:'steel-potatoes',contractId:'etg0013',actor:'Guard verifier',role:'admin',demoRoles:true,at:new Date()};
 const row=await prisma.benefitChange.findFirstOrThrow({where:{status:'Rolled back'},orderBy:{createdAt:'desc'}}),d=JSON.parse(row.data) as ChangeData;
 const events=await prisma.benefitChangeEvent.findMany({where:{changeId:row.id},orderBy:{revision:'asc'}}),first=events[0];
 const old=await getChange({...a,at:first.createdAt},row.id,true);assert(!old.data.deployedAt);assert.equal(old.status,'Draft');const list=await listChanges({...a,at:first.createdAt},1,true);assert.equal(list.rows.find(x=>x.id===row.id)?.status,'Draft');
 const full=await getChange(a,row.id,false,true);assert(full.data.sourceEvidence);assert(full.events.length>5);
 const bad=await simulateClaims({sponsorId:a.sponsorId,contractId:a.contractId},d,d.override,true);assert(bad.results.some(x=>!x.passed));
 const corrected=reprocessBatch({id:'guard',at:new Date().toISOString(),version:d.version!.id,fault:true,...bad});assert(corrected.length>0);assert(corrected.every(x=>x.passed));
 await assert.rejects(()=>command(a,row.id,{command:'edit',proposal:d.proposal,revision:row.revision,requestId:randomUUID()}));
 await assert.rejects(()=>command(a,row.id,{command:'monitor',revision:row.revision-1,requestId:randomUUID()}));
 await assert.rejects(()=>getChange({...a,sponsorId:'another-sponsor'},row.id));
 console.log('Guard checks passed: exact-input repair, immutable deployment, historical list/detail, complete source export, stale revision, sponsor scope.');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
