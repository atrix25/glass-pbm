import {expect,it} from 'vitest';
import {detect} from '@/lib/contract-checks/detector';
import {evidenceFor} from '@/lib/contract-checks/evidence';
import {testInventory,findingEvidence,TESTS,COVERAGE_GAPS} from '@/lib/contract-checks/inventory';
const cutoff='2023-03-31T00:00:00.000Z';
it('lists every check, including clear checks and blocked populations',()=>{
 const e=evidenceFor('tennessee'),r=detect(e,cutoff),tests=testInventory(e,r);
 expect(tests).toHaveLength(8);expect(tests.filter(t=>t.findings.length)).toHaveLength(5);
 expect(tests.find(t=>t.id==='integrity')?.status).toBe('Clear');
 expect(tests.find(t=>t.id==='accuracy')).toMatchObject({status:'Incomplete',blocked:1});
 expect(tests.find(t=>t.id==='collections')).toMatchObject({pending:1,blocked:1,amountCents:5000});
 expect(COVERAGE_GAPS).toHaveLength(4);
});
it('every operational exception has exactly one test; timing and economics are observations',()=>{
 const e=evidenceFor('tennessee'),r=detect(e,cutoff),tests=testInventory(e,r);
 for(const f of r.findings)expect(tests.filter(t=>t.findings.some(x=>x.id===f.id))).toHaveLength(['timing','economics'].includes(f.category)?0:1);
});
it('does not mark an empty file or inapplicable control clear',()=>{
 const e=evidenceFor('wisconsin');e.claims=[];e.submissions=[];e.receipts=[];e.credits=[];e.guaranteeCredits=[];
 expect(testInventory(e,detect(e,cutoff)).every(t=>t.status==='No applicable records')).toBe(true);
});
it('explains partial collection using source amounts and its deadline',()=>{
 const e=evidenceFor('tennessee'),r=detect(e,cutoff),f=r.findings.find(f=>f.kind==='Manufacturer underpayment')!;
 const evidence=findingEvidence(e,cutoff,f);
 expect(evidence.comparison).toMatchObject({expected:20000,actual:15000,deadline:'2023-03-01T00:00:00.000Z'});
 expect(evidence.records.receipts).toHaveLength(1);
});
it('reconciles test amounts to the existing detector totals without including timing balances',()=>{
 const e=evidenceFor('tennessee'),r=detect(e,cutoff),tests=testInventory(e,r);
 expect(tests.filter(t=>['submission','collections'].includes(t.id)).reduce((s,t)=>s+(t.amountCents??0),0)).toBe(r.collectionExposureCents);
});
it('exposes both Wisconsin noncash differences, with no false reversal pass',()=>{
 const e=evidenceFor('wisconsin'),r=detect(e,'2024-06-30T00:00:00.000Z'),tests=testInventory(e,r);
 expect(tests.find(t=>t.id==='offsets')).toMatchObject({status:'Exceptions',amountCents:40000,evaluated:2});
 expect(tests.find(t=>t.id==='reversals')?.status).toBe('No applicable records');
});
it('never reveals future receipts or reversals in a drilldown',()=>{
 const e=evidenceFor('tennessee'),r=detect(e,cutoff),f=r.findings.find(f=>f.kind==='Credit on a reversed claim')!;
 const early=findingEvidence(e,'2022-01-31T00:00:00.000Z',f);
 expect(early.claim?.reversedAt).toBeUndefined();expect(early.records.receipts).toEqual([]);
});
it('catalog IDs and operational finding kinds are unique',()=>{
 expect(new Set(TESTS.map(t=>t.id)).size).toBe(TESTS.length);
 const kinds=TESTS.flatMap(t=>[...t.kinds]);expect(new Set(kinds).size).toBe(kinds.length);
});
