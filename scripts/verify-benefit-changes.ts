import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {prisma} from '../src/lib/db';
import {createChange,command,analyze,getChange,type ChangeAccess} from '../src/lib/benefit-changes/store';
import type {Proposal} from '../src/lib/benefit-changes/types';
async function main(){const a:ChangeAccess={sponsorId:'steel-potatoes',contractId:'etg0013',actor:'Recorded demo verifier',role:'admin',demoRoles:true,at:new Date()};
const date=new Date().toISOString().slice(0,10),drug=await prisma.formularyEntry.findFirstOrThrow({where:{formularyId:'navitus-etf-2026',requiresPA:true}});
const baseline=await prisma.claim.aggregate({where:{sponsorId:a.sponsorId},_count:true,_sum:{patientPayCents:true,planPaidCents:true}});
for(const kind of ['copay','pa','specialty','blocked'] as const){
 const proposal:Proposal={kind,copayCents:300,drugId:drug.drugId,requiresPA:false,specialtyRestricted:false,effectiveDate:date,request:'Verification: '+kind};
 const createInput={requestId:randomUUID(),proposal};let row=await createChange(a,createInput);const id=row.id;assert.equal((await createChange(a,createInput)).id,id);
 async function act(c:string,extra:Record<string,unknown>={}){const current=await getChange({...a,at:new Date()},id);await command(a,id,{command:c,revision:current.revision,requestId:randomUUID(),...extra});return getChange({...a,at:new Date()},id)}
 await assert.rejects(()=>command({...a,sponsorId:'other'},id,{command:'check',revision:0,requestId:randomUUID()}));
 await assert.rejects(()=>command(a,id,{command:'deploy',revision:0,requestId:randomUUID()}));
 row=await act('impact');const payload={id,revision:row.revision,mode:'impact',scope:{sponsorId:a.sponsorId,contractId:a.contractId}};console.log('Full-book analysis',kind,id);await analyze(payload);
 row=await act('check');if(kind==='blocked'){assert.equal(row.status,'Blocked');await assert.rejects(()=>act('approve',{role:'Employer',approved:true}));console.log('Blocked example verified');continue;}
 await assert.rejects(()=>command({...a,role:'readonly',demoRoles:false},id,{command:'approve',role:'Employer',approved:true,revision:row.revision,requestId:randomUUID()}));
 await act('approve',{role:'Employer',approved:true});if(kind!=='copay')await act('approve',{role:'Clinical',approved:true});await act('version');row=await act('test');assert.equal(row.status,'Tested',JSON.stringify(row.data.tests));
 const current=row;const approval={command:'deploy',revision:current.revision,requestId:randomUUID()};await command(a,id,approval);await command(a,id,approval);
 row=await act('monitor');assert(row.data.outcomes.length>0);assert(row.data.outcomes[0].results.every(x=>x.passed));
 row=await act('fault');assert.equal(row.status,'Discrepancy detected');assert(row.data.outcomes.at(-1)?.results.some(x=>!x.passed));
 row=await act('reprocess');assert.equal(row.status,'Verified');row=await act('rollback');assert.equal(row.status,'Rolled back');await assert.rejects(()=>act('monitor'));
 const first=await prisma.benefitChangeEvent.findFirstOrThrow({where:{changeId:id},orderBy:{revision:'asc'}});const old=await getChange({...a,at:first.createdAt},id,true);assert(!old.data.deployedAt);
 console.log('Verified journey',kind,id,row.data.impact?.claimsEvaluated);
}
const after=await prisma.claim.aggregate({where:{sponsorId:a.sponsorId},_count:true,_sum:{patientPayCents:true,planPaidCents:true}});assert.deepEqual(after,baseline);console.log('All journeys verified. Operational claims unchanged.');}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
