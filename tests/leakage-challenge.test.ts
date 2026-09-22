import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {inject,digest} from '@/lib/leakage-challenge/injector';
import {score} from '@/lib/leakage-challenge/evaluator';
import {runDetector} from '@/lib/leakage-challenge/runner';
import type {AnswerKey} from '@/lib/leakage-challenge/types';
import type {Detection,Finding} from '@/lib/contract-checks/detector';
const seed='independent-qa-sample',salt='test-only-commitment-salt';
for(const sponsor of ['wisconsin','tennessee'] as const){
 it(`${sponsor}: clean controls produce no operational alerts`,()=>{
  const pack=inject(sponsor,seed,salt,200,0),result=runDetector(pack.input,pack.cutoff);
  expect(result.findings.filter(f=>!['timing','economics'].includes(f.category))).toEqual([]);
  expect(result.findings.some(f=>f.category==='timing')).toBe(true);expect(result.findings.some(f=>f.category==='economics')).toBe(true);
 });
 it(`${sponsor}: errors are detected except the deliberately uncovered missing-file case`,()=>{
  const pack=inject(sponsor,seed,salt),result=runDetector(pack.input,pack.cutoff),report=score(pack.answer,result);
  expect(report.injected).toBe(24);expect(report.amountMismatches).toBe(0);expect(report.falsePositives).toEqual([]);
  expect(report.outcomes.filter(o=>o.status==='Missed').every(o=>o.name==='Entire source record omitted')).toBe(true);
  expect(report.missed).toBeGreaterThan(0);expect(report.detected).toBe(24-report.missed);expect(report.cleanClaims).toBe(176);
  expect(result.realizedSavingsCents).toBe(0);
 });
}
it('reproduces evidence and answers from the committed seed, and changes with another seed',()=>{
 const a=inject('tennessee',seed,salt),b=inject('tennessee',seed,salt),c=inject('tennessee','another-seed',salt);
 expect(a).toEqual(b);expect(a.inputHash).not.toBe(c.inputHash);expect(a.commitment).toBe(digest(a.answer));expect(a.inputHash).toBe(digest(a.input));
 const d=inject('tennessee',seed,'different-salt');expect(d.inputHash).toBe(a.inputHash);expect(d.commitment).not.toBe(a.commitment);
});
it('does not include the seed or expected errors in detector inputs',()=>{
 const pack=inject('tennessee',seed,salt),text=JSON.stringify(pack.input);
 for(const key of ['expectedKind','faults',seed,salt,'answer','before','after'])expect(text).not.toContain(key);
 expect(readFileSync('src/lib/leakage-challenge/runner.ts','utf8')).not.toMatch(/^import .*from.*(injector|evaluator|service)/m);
 expect(readFileSync('src/lib/contract-checks/detector.ts','utf8')).not.toMatch(/^import .*from.*(injector|evaluator|challenge|fixtures)/m);
});
it('independently checks each injected monetary difference from original versus changed records',()=>{
 const pack=inject('wisconsin',seed,salt);
 for(const f of pack.answer.faults){
  const before=f.before as {submissions:{amountCents:number}[];receipts:{amountCents:number}[];credits:{amountCents:number}[];guaranteeCredits:{amountCents:number}[]};
  const after=f.after as typeof before;
  const sum=(x:{amountCents:number}[])=>x.reduce((s,r)=>s+r.amountCents,0);
  if(f.name==='Partial manufacturer payment')expect(f.amountCents).toBe(sum(before.receipts)-sum(after.receipts));
  if(f.name==='Missing employer credit')expect(f.amountCents).toBe(sum(before.credits)-sum(after.credits));
  if(f.name==='Duplicate submission')expect(f.amountCents).toBe(sum(after.submissions)-sum(before.submissions));
  if(f.name==='Overstated noncash credit')expect(f.amountCents).toBe(sum(after.guaranteeCredits)-sum(before.guaranteeCredits));
  if(f.name==='Omitted submission')expect(f.amountCents).toBe(sum(before.submissions));
 }
});
it('scores hand-authored outcomes without asking the detector to grade itself',()=>{
 const answer:AnswerKey={version:'unit',seed:'x',salt:'x',originalClaimIds:['a','b','c','clean'],faults:[
  {id:'1',claimId:'a',name:'one',expectedKind:'Underpayment',amountCents:500,why:'',before:null,after:null},
  {id:'2',claimId:'b',name:'two',expectedKind:'Underpayment',amountCents:900,why:'',before:null,after:null},
  {id:'3',claimId:'c',name:'three',expectedKind:'Underpayment',amountCents:700,why:'',before:null,after:null},
 ]};
 const finding=(claimId:string,amountCents:number):Finding=>({id:claimId,claimId,kind:'Underpayment',amountCents,category:'collection',evidence:[],termId:null,nextStep:'',owner:''});
 const r=score(answer,{cutoff:'2024-01-01',findings:[finding('a',500),finding('b',800),finding('clean',100)]} as Detection);
 expect(r).toMatchObject({detected:1,amountMismatches:1,missed:1,cleanClaims:1,cleanClaimsFlagged:1,precision:2/3,detectionRate:2/3,exactRate:1/3,falsePositiveRate:1});
 expect(r.falsePositives).toHaveLength(1);
});
it('does not reuse a duplicate alert as a second hit',()=>{
 const pack=inject('tennessee',seed,salt),r=runDetector(pack.input,pack.cutoff);r.findings.push({...r.findings.find(f=>f.kind==='Missing submission amount')!,id:'duplicate-alert'});
 expect(score(pack.answer,r).falsePositives).toHaveLength(1);
});
it('bounds book size and validates fault counts',()=>{
 expect(()=>inject('tennessee',seed,salt,199)).toThrow();expect(()=>inject('tennessee',seed,salt,200,181)).toThrow();
 const pack=inject('tennessee',seed,salt,1000,120);expect(pack.answer.originalClaimIds).toHaveLength(1000);expect(pack.answer.faults).toHaveLength(120);
});
