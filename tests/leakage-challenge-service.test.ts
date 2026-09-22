import {beforeEach,expect,it,vi} from 'vitest';
const db=vi.hoisted(()=>({$queryRaw:vi.fn(),leakageChallenge:{findUnique:vi.fn(),findFirst:vi.fn(),create:vi.fn(),update:vi.fn(),findMany:vi.fn()}}));
vi.mock('@/lib/db',()=>({prisma:{...db,$transaction:(fn:(t:typeof db)=>unknown)=>fn(db)}}));
import {createChallenge,evaluateChallenge,readChallenge} from '@/lib/leakage-challenge/service';
import {inject} from '@/lib/leakage-challenge/injector';
const pack=inject('tennessee','private-seed','private-salt');
const record=()=>({id:'lch_test',key:'key',tenantId:'steel-potatoes',sponsorId:'tennessee',input:JSON.stringify(pack.input),inputHash:pack.inputHash,sealedAnswer:JSON.stringify(pack.answer),commitment:pack.commitment,cutoff:new Date(pack.cutoff),createdAt:new Date('2026-09-01'),scoredAt:null,result:null,score:null,detectorVersion:null});
const clock=new Date('2026-09-22');
beforeEach(()=>{vi.resetAllMocks();db.leakageChallenge.findFirst.mockResolvedValue(record());});
it('withholds the answer, seed, salt and clean baseline before scoring',async()=>{
 const view=await readChallenge('lch_test','tennessee',clock);expect(view?.answer).toBeNull();expect(view?.score).toBeNull();
 const text=JSON.stringify(view);expect(text).not.toContain('private-seed');expect(text).not.toContain('private-salt');expect(text).not.toContain('sealedAnswer');expect(text).not.toContain('originalClaimIds');
});
it('executes a narrow input read before loading the answer and records a single immutable score',async()=>{
 await evaluateChallenge('lch_test','tennessee',clock);
 const read=db.leakageChallenge.findFirst.mock.calls[0][0];expect(read.select).not.toHaveProperty('sealedAnswer');expect(read.where).toMatchObject({sponsorId:'tennessee',tenantId:'steel-potatoes'});
 const data=db.leakageChallenge.update.mock.calls[0][0].data;expect(JSON.parse(data.score).missed).toBeGreaterThan(0);expect(JSON.parse(data.result).realizedSavingsCents).toBe(0);
 db.leakageChallenge.findFirst.mockResolvedValue({...record(),...data});await evaluateChallenge('lch_test','tennessee',clock);expect(db.leakageChallenge.update).toHaveBeenCalledTimes(1);
 const revealed=await readChallenge('lch_test','tennessee',clock);expect(revealed?.answer?.seed).toBe('private-seed');
});
it('rejects evidence or answer tampering without writing a score',async()=>{
 db.leakageChallenge.findFirst.mockResolvedValue({...record(),inputHash:'changed'});await expect(evaluateChallenge('lch_test','tennessee',clock)).rejects.toThrow('integrity');
 db.leakageChallenge.findFirst.mockResolvedValue({...record(),commitment:'changed'});await expect(evaluateChallenge('lch_test','tennessee',clock)).rejects.toThrow('integrity');expect(db.leakageChallenge.update).not.toHaveBeenCalled();
});
it('scopes both execution and reads and suppresses future evidence',async()=>{
 db.leakageChallenge.findFirst.mockResolvedValue(null);expect(await readChallenge('lch_test','wisconsin',clock)).toBeNull();await expect(evaluateChallenge('lch_test','wisconsin',clock)).rejects.toThrow('unavailable');
 expect(db.leakageChallenge.findFirst.mock.calls[0][0].where.sponsorId).toBe('wisconsin');db.leakageChallenge.findFirst.mockResolvedValue(record());expect(await readChallenge('lch_test','tennessee',new Date('2021-01-01'))).toBeNull();
});
it('creates only isolated challenge records and makes repeated create requests idempotent',async()=>{
 db.leakageChallenge.findUnique.mockResolvedValue(null);const id=await createChallenge('tennessee','request-key',200);expect(id).toMatch(/^lch_/);expect(db.leakageChallenge.create).toHaveBeenCalledTimes(1);
 const data=db.leakageChallenge.create.mock.calls[0][0].data;expect(data.result).toBeUndefined();expect(data.score).toBeUndefined();
 db.leakageChallenge.findUnique.mockResolvedValue({...record(),...data});expect(await createChallenge('tennessee','request-key',200)).toBe(id);expect(db.leakageChallenge.create).toHaveBeenCalledTimes(1);
 await expect(createChallenge('tennessee','request-key',1000)).rejects.toThrow('different inputs');
});
