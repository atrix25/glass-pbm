import {describe,it,expect} from 'vitest';
import {generate,costShare,reference,ingredientCents} from '@/lib/realistic-book/core';
import {verify} from '@/lib/realistic-book/verify';
const b=generate();
describe('longitudinal synthetic employer book',()=>{
 it('uses multiple months, channels, actual public references and unique synthetic people',()=>{expect(b.members).toHaveLength(240);expect(b.claims.length).toBeGreaterThan(1700);expect(new Set(b.claims.map(c=>c.date.slice(0,7))).size).toBe(9);expect(new Set(b.claims.map(c=>c.channel)).size).toBe(3);expect(b.claims.filter(c=>c.status==='Paid').every(c=>/^\d{11}$/.test(c.ndc)&&c.price?.line)).toBe(true);expect(b.members.some(m=>!b.claims.some(c=>c.memberId===m.id))).toBe(true);});
 it('calculates deductible, coinsurance, caps, copays and exemptions against authored amounts',()=>{
  expect(costShare(100000,'HDHP','Brand',false,20000,20000,false)).toEqual({member:44000,employer:56000,deductibleAfter:50000,oopAfter:64000});
  expect(costShare(100000,'HDHP','Brand',false,0,245000,false)).toEqual({member:5000,employer:95000,deductibleAfter:5000,oopAfter:250000});
  expect(costShare(100000,'HDHP','Generic',false,0,0,true)).toEqual({member:20000,employer:80000,deductibleAfter:0,oopAfter:20000});
  expect(costShare(300,'Copay','Generic',false,0,0,false).member).toBe(300);
  expect(costShare(10000,'Copay','Brand',true,0,0,false).member).toBe(9000);
  expect(costShare(800000,'Copay','Specialty',false,0,0,false).member).toBe(15000);
 });
 it('rounds currency from exact public decimal strings',()=>{expect(ingredientCents('1.005',1)).toBe(101);expect(ingredientCents('0.125',8.5)).toBe(106);expect(ingredientCents('0.01419',60)).toBe(85);});
 it('aligns dependent enrollment with the household employee',()=>{for(const m of b.members){const employee=b.members.find(e=>e.household===m.household&&e.relationship==='Employee')!;expect(m.start).toBe(employee.start);expect(m.end).toBe(employee.end);if(m.relationship==='Child')expect(employee.age-m.age).toBeGreaterThanOrEqual(18);}});
 it('contains real accumulator progression to the OOP maximum',()=>{expect(b.claims.some(c=>c.oopAfter===250000)).toBe(true);expect(b.claims.some(c=>c.oopBefore===250000&&c.status==='Paid'&&c.member===0)).toBe(true);});
 it('keeps enrollment rejections, PA resubmissions, network exceptions and quantity limits',()=>{for(const reason of ['Eligibility inactive','Prior authorization required','Out-of-network pharmacy','Quantity limit exceeded'])expect(b.claims.some(c=>c.reason===reason)).toBe(true);expect(b.claims.some(c=>c.originalId&&c.status==='Paid')).toBe(true);});
 it('passes independent record-level checks',()=>{expect(verify(b).filter(c=>!c.passed)).toEqual([]);});
 it('detects changed amounts, broken books and incomplete employer credits',()=>{const bad=structuredClone(b);bad.claims.find(c=>c.status==='Paid')!.allowed++;bad.journal[0].lines[0].debit++;bad.journal.find(j=>j.id==='2026-Q2-credit')!.lines[1].credit--;expect(verify(bad).filter(c=>!c.passed).length).toBeGreaterThanOrEqual(3);});
 it('excludes later price snapshots and does not fabricate missing references',()=>{expect(reference('70010006310','2026-01-01')).toBeUndefined();expect(reference('99999999999','2026-09-30')).toBeUndefined();expect(reference('70010006310','2026-08-26')?.['NADAC Per Unit']).toBe('0.01419');});
 it('preserves full employer entitlement under partial collection and leaves not-due periods open',()=>{const q2=b.rebates[1],q3=b.rebates[2];expect(q2.manufacturerReceived).toBeLessThan(q2.entitlement);expect(b.journal.find(j=>j.id==='2026-Q2-credit')?.lines[1].credit).toBe(q2.entitlement);expect(q3.manufacturerReceived).toBe(0);expect(b.journal.some(j=>j.id==='2026-Q3-credit')).toBe(false);});
 it('does not net a previous month payment into the next invoice',()=>{for(let month=1;month<=8;month++){const period='2026-'+String(month).padStart(2,'0');const expected=b.journal.filter(j=>j.date.startsWith(period)&&!j.id.endsWith('-client-payment')).flatMap(j=>j.lines).filter(l=>l.account==='Employer receivable').reduce((n,l)=>n+l.debit-l.credit,0);expect(b.journal.find(j=>j.id===period+'-client-payment')?.lines[0].debit).toBe(expected);}});
 it('is reproducible without baking in outcomes from the verifier',async()=>{const again=generate();expect(again.claims).toEqual(b.claims);expect(again.journal).toEqual(b.journal);const {readFileSync}=await import('node:fs');expect(readFileSync('src/lib/realistic-book/core.ts','utf8')).not.toMatch(/import.*verify/);});
});
