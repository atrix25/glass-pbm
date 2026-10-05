import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {source,createState,digest,assertIntegrity,recordReview,visibleState,assertAvailable} from '../src/lib/formulary-checks/core';
import {compileRows} from '../src/lib/formulary-checks/processor';
import {verifyDrafts} from '../src/lib/formulary-checks/expected';
const at=new Date('2026-10-05T12:00:00Z');
describe('published Tennessee requirements to draft configuration',()=>{
 it('retains the original PDF and exact selected population',()=>{
  expect(createHash('sha256').update(readFileSync('public'+source.localUrl)).digest('hex')).toBe(source.sha256);
  expect(source.rows).toHaveLength(99);expect(new Set(source.rows.map(r=>r.id)).size).toBe(99);
  expect(source.selectedPages).toEqual([22,64,124]);expect(source.totalPages).toBe(365);
  for(const r of source.rows){expect(r.box.width).toBeGreaterThan(0);expect(r.box.y+r.box.height).toBeLessThan(r.height);expect(r.box.x+r.box.width).toBeLessThan(r.width);}
 });
 it('passes the twelve separately authored reference cases without claiming operations',()=>{
  const s=createState(at);expect(s.outputs).toHaveLength(99);expect(s.tests).toHaveLength(12);
  expect(s.tests.every(t=>t.status==='Passed')).toBe(true);expect(s.outputs.every(o=>!o.issues.length)).toBe(true);
  expect(s.operationalStatus).toBe('Not connected');expect(s.activation).toBe('Draft only');expect(s.reviews).toEqual([]);
 });
 it('preserves blank restrictions as unknown rather than false and never invents criteria',()=>{
  const outputs=createState(at).outputs,blank=outputs.find(o=>o.id==='p64-r3')!,restricted=outputs.find(o=>o.id==='p124-r1')!;
  expect([blank.PA,blank.ST,blank.QL,blank.SP]).toEqual([null,null,null,null]);
  expect([restricted.PA,restricted.ST,restricted.QL,restricted.SP]).toEqual([true,true,true,null]);
  expect(restricted.quantityLimit).toBeNull();expect(restricted.clinicalCriteria).toBeNull();
 });
 it('does not merge brand and generic products or infer tier from drug label',()=>{
  const outputs=createState(at).outputs;
  expect(outputs.find(o=>o.id==='p124-r36')).toMatchObject({classification:'Generic',tier:1,PA:null});
  expect(outputs.find(o=>o.id==='p124-r37')).toMatchObject({classification:'Brand',tier:3,PA:true});
  expect(outputs.find(o=>o.id==='p124-r27')).toMatchObject({classification:'Brand',tier:1});
 });
 it('blocks missing, conflicting and unsupported cells without mutating source records',()=>{
  const rows=structuredClone(source.rows.slice(0,4));rows[0].cells.tier='';rows[1].cells.drug+=' Generic drug';rows[2].cells.limits='Unknown';rows[3].name='Wrong';
  const frozen=digest(rows),outputs=compileRows(rows,source.effectiveDate);expect(outputs.every(o=>o.issues.length>0)).toBe(true);expect(digest(rows)).toBe(frozen);
 });
 it('independent verifier detects omissions, duplicates, changed flags and dates',()=>{
  const outputs=createState(at).outputs;outputs.find(o=>o.id==='p22-r3')!.PA=null;outputs.find(o=>o.id==='p64-r3')!.effectiveDate='2025-10-01';outputs.splice(outputs.findIndex(o=>o.id==='p124-r1'),1);outputs.push(outputs.find(o=>o.id==='p124-r37')!);
  expect(verifyDrafts(outputs).filter(t=>t.status==='Failed').map(t=>t.id)).toEqual(['p22-r3','p64-r3','p124-r1','p124-r37']);
 });
 it('records actual review history without rewriting configuration or activating benefits',()=>{
  const s=createState(at),hash=s.outputHash;
  recordReview(s,'p22-r3','Needs correction','Check transcription','Test reviewer',at);
  recordReview(s,'p22-r3','Correct','Compared to source','Test reviewer',new Date('2026-10-05T13:00:00Z'));
  expect(s.reviews).toHaveLength(2);expect(s.outputHash).toBe(hash);expect(s.activation).toBe('Draft only');
  expect(visibleState(s,new Date('2026-10-05T12:30:00Z'))!.reviews).toHaveLength(1);
  expect(visibleState(s,new Date('2026-10-05T11:00:00Z'))).toBeNull();
 });
 it('rejects version changes, unexplained corrections and approving failed checks',()=>{
  const s=createState(at);expect(()=>recordReview(s,'p22-r3','Needs correction','','Test',at)).toThrow();
  s.tests[0].status='Failed';expect(()=>recordReview(s,'p22-r3','Correct','','Test',at)).toThrow('Failed checks');
  s.outputs[0].tier=1;expect(()=>assertIntegrity(s)).toThrow();
 });
 it('scopes sources to Tennessee and suppresses future evidence',()=>{
  expect(()=>assertAvailable('wisconsin',at)).toThrow('Select Tennessee');expect(()=>assertAvailable('tennessee',new Date('2026-10-04'))).toThrow('cutoff');expect(()=>assertAvailable('tennessee',at)).not.toThrow();
 });
});
