import {describe,it,expect} from 'vitest';
import {dataset,manifest,assertCutoff} from '@/lib/public-data-checks/data';
import {compare,buildDraft,priceAt,buildPriceLookups} from '@/lib/public-data-checks/processor';
import {verify,verifyPrices,verifyPriceLookups} from '@/lib/public-data-checks/verifier';
const data=dataset(),before=data.snapshots['2026-08'],after=data.snapshots['2026-09'];
describe('published plan sources',()=>{
 it('imports the exact plan and separate dated populations',()=>{
  for(const rows of [before,after]){const plan=rows.filter(r=>r.area==='plan');expect(plan).toHaveLength(1);expect(plan[0].values).toMatchObject({CONTRACT_ID:'S5601',PLAN_ID:'024',SEGMENT_ID:'000',PDP_REGION_CODE:'12',PREMIUM:'97.30',DEDUCTIBLE:'615'});}
  expect(before.filter(r=>r.area==='formulary')).toHaveLength(3393);expect(after.filter(r=>r.area==='formulary')).toHaveLength(3405);
  expect(before.filter(r=>r.area==='network')).toHaveLength(60514);expect(after.filter(r=>r.area==='network')).toHaveLength(60521);
 });
 it('detects the independently counted formulary additions/removals without metadata inflation',()=>{
  const changes=compare(before,after).filter(c=>c.area==='formulary');expect(changes.filter(c=>c.kind==='Added')).toHaveLength(29);expect(changes.filter(c=>c.kind==='Removed')).toHaveLength(17);expect(changes.filter(c=>c.kind==='Changed')).toHaveLength(0);
  expect(compare(before,after).filter(c=>['plan','benefits','insulin'].includes(c.area))).toHaveLength(0);
 });
 it('updates an old draft and independently verifies every selected field',()=>{
  const draft=buildDraft(before,after,compare(before,after)),checks=verify(data,draft,manifest.census['2026-09']);expect(checks.filter(c=>c.status==='Failed')).toEqual([]);expect(checks.filter(c=>c.status==='Missing evidence')).toHaveLength(2);
  expect(draft).toHaveLength(after.length);
 });
 it('detects a wrong benefit, missing addition, retained removal, and duplicate',()=>{
  const base=buildDraft(before,after,compare(before,after));
  for(const mutate of [(d:typeof base)=>{d.find(r=>r.area==='plan')!.values.DEDUCTIBLE='0';},(d:typeof base)=>{d.splice(d.findIndex(r=>r.area==='formulary'),1);},(d:typeof base)=>{d.push({...d[0],id:'unexpected'});},(d:typeof base)=>{d.push(d[0]);}]){const draft=structuredClone(base);mutate(draft);expect(verify(data,draft,manifest.census['2026-09']).some(c=>c.status==='Failed')).toBe(true);}
 });
 it('does not let missing changes produce a passing draft',()=>{expect(verify(data,buildDraft(before,after,[]),manifest.census['2026-09']).some(c=>c.status==='Failed')).toBe(true);});
 it('rejects duplicate source identifiers',()=>{expect(()=>compare([...before,before[0]],after)).toThrow('Duplicate');});
 it('preserves leading zeros, decimal strings, units and dates',()=>{expect(verifyPrices(data).some(c=>c.status==='Failed')).toBe(false);expect(data.prices.every(r=>r.values.NDC.length===11)).toBe(true);expect(data.prices.some(r=>r.values.NDC.startsWith('0'))).toBe(true);});
 it('never selects a price before publication or with a mismatched unit',()=>{
  const row=data.prices[0],ndc=row.values.NDC,unit=row.values['Pricing Unit'];expect(priceAt(data.prices,ndc,unit,'2026-08-25','2026-09-30')).toBeNull();expect(priceAt(data.prices,ndc,'UNKNOWN','2026-09-30','2026-09-30')).toBeNull();expect(priceAt(data.prices,ndc,unit,'2026-09-30','1900-01-01')).toBeNull();expect(priceAt(data.prices,'99999999999',unit,'2026-09-30','2026-09-30')).toBeNull();
 });
 it('verifies dated price outputs and detects altered rates',()=>{const outputs=buildPriceLookups(data.prices);expect(verifyPriceLookups(data,outputs).status).toBe('Passed');outputs[0].rate='999';expect(verifyPriceLookups(data,outputs).status).toBe('Failed');});
 it('returns independently transcribed real NADAC prices at date boundaries',()=>{expect(priceAt(data.prices,'31722055760','EA','2026-08-26','2026-08-26')?.values['NADAC Per Unit']).toBe('0.53801');expect(priceAt(data.prices,'31722055760','EA','2026-09-30','2026-09-30')?.values['NADAC Per Unit']).toBe('0.54555');expect(priceAt(data.prices,'31722055760','EA','2026-09-29','2026-09-30')?.values['NADAC Per Unit']).toBe('0.53801');});
 it('does not reveal retrieved data at an earlier evidence cutoff',()=>{expect(()=>assertCutoff(new Date('2026-01-01'))).toThrow('cutoff');expect(()=>assertCutoff(new Date('2026-12-31'))).not.toThrow();});
 it('does not import the verifier into processing',async()=>{const {readFileSync}=await import('node:fs');expect(readFileSync('src/lib/public-data-checks/processor.ts','utf8')).not.toMatch(/import.*verifier|import.*expected/);});
});
