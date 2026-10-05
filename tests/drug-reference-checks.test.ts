import {describe,it,expect} from 'vitest';
import records from '../data/public-drug-reference/maine/records.json';
import {processRecords} from '../src/lib/drug-reference-checks/process';
import {verifyOutputs} from '../src/lib/drug-reference-checks/expected';
import {runReferenceChecks} from '../src/lib/drug-reference-checks/run';
describe('public drug classification demonstration',()=>{
 it('uses 282 real records and passes exactly five independently expected cases',()=>{
 const r=runReferenceChecks('tennessee',new Date('2026-10-06'),new Date('2026-10-06'));
 expect(r.summary).toEqual({records:282,validRecords:282,blocked:0,applicable:5,outsideRule:277,verified:5,failed:0});
 expect(r.status).toBe('Passed');expect(r.operationalResult).toBe('Not assessed');expect(r.outputs.every(o=>o.classificationEffectiveDate===null)).toBe(true);
 expect(r.outputs.find(o=>o.ndc11==='00115169449')?.producedBucket).toBe('Generic');
 });
 it('does not confuse single-source brand or multi-source generic with rule cases',()=>{
 const output=processRecords(records);expect(output.find(r=>r.ndc11==='00074024302')?.producedBucket).toBeNull();expect(output.filter(r=>r.publishedSourceType==='Multi-Source').every(r=>r.producedBucket===null)).toBe(true);
 });
 it('blocks duplicate, conflicting and missing source evidence',()=>{
 const target=records.find(r=>r.ndc11==='00115169449')!;
 expect(processRecords([target,target]).every(r=>r.processing==='Blocked')).toBe(true);
 expect(processRecords([{...target,publishedSourceType:''}])[0].producedBucket).toBeNull();
 expect(processRecords([{...target,reportedBrandGeneric:'brand'}])[0].issues).toContain('Conflicting classification');
 expect(processRecords([{...target,ndc11:'115169449'}])[0].issues).toContain('Invalid NDC');
 });
 it('independently catches wrong, missing and extra outputs',()=>{
 const good=processRecords(records);const wrong=structuredClone(good);wrong.find(r=>r.ndc11==='00115169449')!.producedBucket='Brand';expect(verifyOutputs(wrong).failed).toBe(1);
 expect(verifyOutputs(good.filter(r=>r.ndc11!=='00115169449')).failed).toBe(1);
 expect(verifyOutputs([...good,{ndc11:'00000000000',producedBucket:'Generic',issues:[]}]).unexpected).toEqual(['00000000000']);
 });
 it('preserves inputs and yields repeatable digests without operational writes',()=>{
 const before=JSON.stringify(records),now=new Date('2026-10-06');const a=runReferenceChecks('tennessee',now,now),b=runReferenceChecks('tennessee',now,now);expect(a).toEqual(b);expect(JSON.stringify(records)).toBe(before);
 });
 it('blocks other sponsors and future source evidence',()=>{
 expect(()=>runReferenceChecks('wisconsin',new Date('2026-10-06'))).toThrow('Select Tennessee');expect(()=>runReferenceChecks('tennessee',new Date('2026-10-04'))).toThrow('cutoff');
 });
});
