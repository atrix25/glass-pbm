import {afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {prisma} from '../src/lib/db';
import {mutate,detail,list} from '../src/lib/onboarding/store';
import {planDay} from '../src/lib/onboarding/domain';
import type {ChangeAccess} from '../src/lib/benefit-changes/store';
const a:ChangeAccess={sponsorId:'test-onboarding-'+randomUUID(),contractId:'isolated-test',actor:'Test actor',at:new Date(),role:'admin',demoRoles:false};
const setup={name:'Persistence test',effectiveDate:planDay(new Date().toISOString()),goal:'Balance',kind:'copay',copayCents:300,requiresPA:false,specialtyRestricted:false};
const ids:string[]=[];
afterAll(async()=>{await prisma.sapphireOnboardingEvent.deleteMany({where:{onboardingId:{in:ids}}});await prisma.sapphireOnboarding.deleteMany({where:{sponsorId:a.sponsorId}})});
describe('Isolated onboarding persistence',()=>{
 it('is idempotent, scoped, revision guarded and restores historical snapshots',async()=>{
 const requestId=randomUUID(),body={command:'create',requestId,setup};const first=await mutate(a,body);ids.push(first.id);expect((await mutate(a,body)).id).toBe(first.id);
 await expect(mutate(a,{...body,setup:{...setup,name:'Different'}})).rejects.toThrow('different action');
 const before=new Date();await new Promise(r=>setTimeout(r,10));
 await mutate(a,{command:'edit',requestId:randomUUID(),id:first.id,revision:0,setup:{...setup,name:'Revised'}});
 expect((await detail({...a,at:new Date()},first.id,false)).name).toBe('Revised');expect((await detail({...a,at:before},first.id,true)).name).toBe(setup.name);
 await expect(detail({...a,sponsorId:'other',at:new Date()},first.id,false)).rejects.toThrow('not found');expect((await list({...a,sponsorId:'other'},false)).rows).toHaveLength(0);
 await expect(mutate(a,{command:'validate',requestId:randomUUID(),id:first.id,revision:0})).rejects.toThrow('Refresh');
 const input={command:'validate',requestId:randomUUID(),id:first.id,revision:1};const outcomes=await Promise.all([mutate(a,input),mutate(a,input)]);expect(outcomes[0].id).toBe(outcomes[1].id);expect((await detail({...a,at:new Date()},first.id,false)).revision).toBe(2);
 const actions=await Promise.allSettled([mutate(a,{command:'analyze',requestId:randomUUID(),id:first.id,revision:2}),mutate(a,{command:'analyze',requestId:randomUUID(),id:first.id,revision:2})]);expect(actions.filter(x=>x.status==='fulfilled')).toHaveLength(1);
 });
 it('preserves the employer and deployed baseline across follow-up proposals',async()=>{
  let row=await mutate(a,{command:'create',requestId:randomUUID(),setup});ids.push(row.id);
  async function act(id:string,command:string,extra:Record<string,unknown>={}){const current=await detail({...a,at:new Date()},id,false);await mutate(a,{id,revision:current.revision,command,requestId:randomUUID(),...extra});}
  async function launch(id:string){for(const command of ['validate','analyze','check'])await act(id,command);await act(id,'decide',{role:'Employer',approved:true});await act(id,'test');await act(id,'launch');}
  await launch(row.id);await act(row.id,'process');await act(row.id,'support');
  const original=await detail({...a,at:new Date()},row.id,false);expect(original.data.support.length).toBe(4);
  const next=await mutate(a,{command:'propose',id:row.id,revision:original.revision,requestId:randomUUID(),setup:{...setup,copayCents:500}});ids.push(next.id);
  await launch(next.id);const latest=await detail({...a,at:new Date()},next.id,false);expect(latest.employerKey).toBe(original.employerKey);expect(latest.data.version.predecessor).toBe(original.data.version.id);expect(latest.data.impact.memberBefore).toBe(48*300);expect(latest.data.impact.memberAfter).toBe(48*500);
  await expect(act(row.id,'process')).rejects.toThrow('superseded');await act(next.id,'process');expect((await detail({...a,at:new Date()},row.id,false)).data.outcomes).toHaveLength(12);
 });
 it('does not accept unauthorized roles or deploy without evidence',async()=>{await expect(mutate({...a,role:'readonly'},{command:'create',requestId:randomUUID(),setup})).rejects.toThrow('authorized');const row=await mutate(a,{command:'create',requestId:randomUUID(),setup});ids.push(row.id);await expect(mutate({...a,role:'plan_sponsor'},{command:'launch',id:row.id,revision:0,requestId:randomUUID()})).rejects.toThrow('Operations');await expect(mutate(a,{command:'launch',id:row.id,revision:0,requestId:randomUUID()})).rejects.toThrow('evidence');});
});
