import {it,expect,afterAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {prisma} from '../src/lib/db';
import {changeStudy,getStudy} from '../src/lib/plan-studio/store';
import type {ChangeAccess} from '../src/lib/benefit-changes/store';
const a:ChangeAccess={sponsorId:'test-study-'+randomUUID(),contractId:'test',actor:'Reviewer',at:new Date(),role:'admin',demoRoles:false},ids:string[]=[];
const goals={name:'Employer test',lives:100,currentSpend:null,renewal:'2027-01-01',priority:'balance',contribution:null};
afterAll(async()=>{await prisma.sapphirePlanStudyEvent.deleteMany({where:{studyId:{in:ids}}});await prisma.sapphirePlanStudy.deleteMany({where:{id:{in:ids}}})});
it('persists selected full designs, invalidates selection after edits and preserves historical evidence',async()=>{
 const input={command:'create',requestId:randomUUID(),goals};const id=await changeStudy(a,input);ids.push(id);expect(await changeStudy(a,input)).toBe(id);
 const read=()=>getStudy({...a,at:new Date()},id,false);
 await changeStudy(a,{command:'select',requestId:randomUUID(),id,revision:0,selected:'cost'});const selected=await read();expect(selected.data.selected).toBe('cost');const cutoff=new Date();await new Promise(r=>setTimeout(r,5));
 await changeStudy(a,{command:'recalculate',requestId:randomUUID(),id,revision:1,goals:{...goals,lives:200}});expect((await read()).data.selected).toBeUndefined();expect((await getStudy({...a,at:cutoff},id,true)).data.selected).toBe('cost');
 await expect(changeStudy(a,{command:'select',id,revision:1,requestId:randomUUID(),selected:'balance'})).rejects.toThrow('Refresh');
 await expect(getStudy({...a,at:new Date(),sponsorId:'other'},id,false)).rejects.toThrow('not found');await expect(getStudy({...a,at:new Date(),role:'readonly'},id,false)).rejects.toThrow('access');
 const req={command:'select',id,revision:2,requestId:randomUUID(),selected:'balance'};expect(await Promise.all([changeStudy(a,req),changeStudy(a,req)])).toEqual([id,id]);expect((await read()).revision).toBe(3);
});
