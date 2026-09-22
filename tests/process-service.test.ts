import {beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
const db=vi.hoisted(()=>({$queryRaw:vi.fn(),assuranceRun:{findFirst:vi.fn(),upsert:vi.fn(),updateMany:vi.fn(),findMany:vi.fn()}}));
vi.mock('@/lib/db',()=>({prisma:{...db,$transaction:(f:(t:typeof db)=>unknown)=>f(db)}}));
import {createProcess,readProcess,processCommand} from '@/lib/assurance/process/service';
import {newProcess} from '@/lib/assurance/process/source';
const clock=new Date('2026-09-22'),command={action:'flow' as const,id:'prc_test',key:'test-key',revision:0};
const row=()=>{const state=newProcess('tennessee');return {id:'prc_test',state:JSON.stringify(state),inputHash:createHash('sha256').update(JSON.stringify(state.baseline)).digest('hex'),revision:0,createdAt:clock};};
beforeEach(()=>{vi.resetAllMocks();db.assuranceRun.findFirst.mockResolvedValue(row());db.assuranceRun.updateMany.mockResolvedValue({count:1});});
it('scopes reads by sponsor, tenant, cutoff and process ID',async()=>{await readProcess('prc_test','tennessee',clock);expect(db.assuranceRun.findFirst.mock.calls[0][0].where).toMatchObject({id:'prc_test',sponsorId:'tennessee',tenantId:'steel-potatoes',cutoff:{lte:clock}});await readProcess('oas_test','tennessee',clock);expect(db.assuranceRun.findFirst.mock.calls[1][0].where.id).toBe('invalid');});
it('does not write any operational table',async()=>{db.assuranceRun.upsert.mockResolvedValue({id:'prc_test'});await createProcess('tennessee','key','clean');expect(db.assuranceRun.upsert.mock.calls[0][0].create.tenantId).toBe('steel-potatoes');await processCommand('tennessee',clock,command,'test');expect(db.assuranceRun.updateMany).toHaveBeenCalledTimes(1);});
it('serializes changes, rejects stale revisions and guards baseline integrity',async()=>{await expect(processCommand('tennessee',clock,{...command,revision:1},'test')).rejects.toThrow('Stale');db.assuranceRun.findFirst.mockResolvedValue({...row(),inputHash:'wrong'});await expect(processCommand('tennessee',clock,command,'test')).rejects.toThrow('integrity');expect(db.assuranceRun.updateMany).not.toHaveBeenCalled();});
it('deduplicates exact retries and rejects conflicting keys',async()=>{await processCommand('tennessee',clock,command,'test');const data=db.assuranceRun.updateMany.mock.calls[0][0].data;db.assuranceRun.findFirst.mockResolvedValue({...row(),...data});await processCommand('tennessee',clock,command,'test');expect(db.assuranceRun.updateMany).toHaveBeenCalledTimes(1);await expect(processCommand('tennessee',clock,{...command,action:'next'},'test')).rejects.toThrow('Conflicting retry');});
it('does not execute inaccessible runs',async()=>{db.assuranceRun.findFirst.mockResolvedValue(null);await expect(processCommand('wisconsin',clock,command,'test')).rejects.toThrow('unavailable');expect(db.assuranceRun.updateMany).not.toHaveBeenCalled();});

it('rejects a concurrent write that wins the revision race',async()=>{db.assuranceRun.updateMany.mockResolvedValue({count:0});await expect(processCommand('tennessee',clock,command,'test')).rejects.toThrow('Stale');});
