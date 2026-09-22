import { expect, it } from "vitest";
import { detect, evidenceAt } from "@/lib/contract-checks/detector";
import { evidenceFor } from "@/lib/contract-checks/evidence";
import expected from "./fixtures/contract-check-expected.json";
for(const sponsor of ["tennessee","wisconsin"] as const)it(`${sponsor}: matches independently specified amounts and findings`,()=>{
 const {findings,...totals}=expected[sponsor],actual=detect(evidenceFor(sponsor),totals.cutoff);
 expect(actual).toMatchObject(totals);expect(actual.findings.map(f=>[f.claimId,f.kind,f.amountCents])).toEqual(findings);expect(actual.realizedSavingsCents).toBe(0);
});
it("detects a changed amount without a predefined scenario or answer key",()=>{
 const input=evidenceFor("tennessee");input.claims[0].id="unseen-claim";input.terms[0].manufacturerRateCents=23719;
 expect(detect(input,expected.tennessee.cutoff).findings.find(f=>f.claimId==="unseen-claim")?.amountCents).toBe(23719);
});
it("does not raise a missing submission once the evidence supplies it",()=>{
 const input=evidenceFor("tennessee");input.submissions.push({id:"new-invoice",claimId:input.claims[0].id,amountCents:12000,recordedAt:"2022-02-01T00:00:00.000Z"});
 const result=detect(input,expected.tennessee.cutoff);expect(result.findings.some(f=>f.claimId===input.claims[0].id&&f.kind==="Missing submission amount")).toBe(false);
 expect(result.realizedSavingsCents).toBe(0);expect(result.collectionExposureCents).toBe(17000);
});
it("receipt alone does not satisfy employer delivery",()=>{
 const input=evidenceFor("tennessee"),c=input.claims[0];
 input.submissions.push({id:"invoice",claimId:c.id,amountCents:12000,recordedAt:"2022-02-01T00:00:00.000Z"});
 input.receipts.push({id:"receipt",claimId:c.id,amountCents:12000,recordedAt:"2022-02-01T00:00:00.000Z",settledAt:"2022-02-01T00:00:00.000Z"});
 const r=detect(input,expected.tennessee.cutoff);expect(r.collectionExposureCents).toBe(5000);expect(r.employerOutstandingCents).toBe(19000);
});
it("is independent of row order",()=>{const input=evidenceFor("tennessee"),a=detect(input,expected.tennessee.cutoff);input.claims.reverse();input.submissions.reverse();input.terms.reverse();expect(detect(input,expected.tennessee.cutoff).collectionExposureCents).toBe(a.collectionExposureCents);});
it("suppresses future reversals, receipts and reviews at historical cutoffs",()=>{
 const input=evidenceFor("tennessee"),cutoff="2022-01-31T00:00:00.000Z",r=detect(input,cutoff);
 expect(r.cashCents).toBe(0);expect(r.incorrectCreditCents).toBe(0);expect(r.collectionExposureCents).toBe(0);
 const exported=evidenceAt(input,cutoff);expect(exported.receipts).toEqual([]);expect(exported.claims[2].reversedAt).toBeUndefined();
});
it("requires settled receipts, not a future settlement or acceptance alone",()=>{
 const input=evidenceFor("tennessee");input.receipts[0].settledAt="2024-01-01T00:00:00.000Z";
 expect(detect(input,expected.tennessee.cutoff).cashCents).toBe(18000);
});
it("leaves missing or conflicting effective terms unverified",()=>{
 const input=evidenceFor("wisconsin");input.terms.push({...input.terms[0],id:"conflict"});
 const r=detect(input,expected.wisconsin.cutoff);expect(r.complete).toBe(false);expect(r.guaranteeExpenseCents).toBeNull();expect(r.findings[0].kind).toBe("Not verified");
});
it("normal timing becomes overdue only at the assumed deadline",()=>{
 const input=evidenceFor("tennessee"),before=detect(input,"2023-06-29T00:00:00.000Z"),after=detect(input,"2023-06-30T00:00:00.000Z");
 expect(after.collectionExposureCents-before.collectionExposureCents).toBe(9000);
});
it("a manufacturer exclusion does not remove a client guarantee",()=>{
 const input=evidenceFor("tennessee");input.claims[6].manufacturerEligible=false;
 const r=detect(input,expected.tennessee.cutoff);expect(r.guaranteeCents).toBe(70000);expect(r.guaranteeExpenseCents).toBe(37000);
});
it("repaired noncash evidence clears Wisconsin findings without manufacturing cash",()=>{
 const input=evidenceFor("wisconsin");input.guaranteeCredits[0].amountCents=30000;input.guaranteeCredits.push({...input.guaranteeCredits[0],id:"correct-credit",claimId:input.claims[0].id});
 const r=detect(input,expected.wisconsin.cutoff);expect(r.findings).toEqual([]);expect(r.cashCents).toBe(30000);expect(r.realizedSavingsCents).toBe(0);
});
it("unmatched cash and duplicate IDs prevent a complete position",()=>{
 const input=evidenceFor("wisconsin");input.receipts.push({...input.receipts[0],claimId:"missing"});
 const r=detect(input,expected.wisconsin.cutoff);expect(r.complete).toBe(false);expect(r.guaranteeExpenseCents).toBeNull();
 expect(r.findings.some(f=>f.kind==="Duplicate record ID")).toBe(true);
});
