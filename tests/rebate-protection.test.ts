import { describe, expect, it } from "vitest";
import expected from "./fixtures/rebate-proof-expected.json";
import { comparison, day, obligation, position, type Event } from "@/lib/rebate-protection/model";
import { eventsForStage, fixture, SCENARIOS } from "@/lib/rebate-protection/scenarios";
const anchor="2026-01-01T00:00:00.000Z";
const settled=(id:string,decision="Approved",cadence:"Monthly"|"Quarterly"="Quarterly")=>{
 const s=fixture(id,anchor,cadence);const events=[0,1,2,3].flatMap(stage=>eventsForStage("test",s,stage,decision));
 return {s,events,result:comparison(s,events,day(anchor,120))};
};
describe("independent rebate proof fixtures",()=>{
 for(const scenario of SCENARIOS)for(const cadence of ["Monthly","Quarterly"] as const)it(`${scenario.id} ${cadence} matches hand-calculated results`,()=>{
  const {result:r}=settled(scenario.id,"Approved",cadence),e=expected[scenario.id as keyof typeof expected];
  expect(r.baseline.receiptsCents).toBe(e.baselineReceipts);expect(r.glass.receiptsCents).toBe(e.glassReceipts);
  expect(r.baseline.operationalLossCents).toBe(e.baselineLoss);expect(r.glass.operationalLossCents).toBe(e.glassLoss);
  expect(r.baseline.topupCents).toBe(e.baselineTopup);expect(r.glass.topupCents).toBe(e.glassTopup);
  expect(r.recognizedBenefitCents).toBe(e.benefit);expect(r.glass.unexpectedGuaranteeCents).toBe(e.unexpected);
  expect(r.glass.entitlementCents).toBe(100000);expect(r.baseline.entitlementCents).toBe(100000);
  expect(r.glass.employerCreditsCents).toBe(100000);
  expect(r.pbmBenefitCents+r.employerBenefitCents).toBe(r.recognizedBenefitCents);
 });
 it("separates manufacturer and client eligibility",()=>{
  const s=fixture("eligibility",anchor,"Quarterly"),c=s.claims[9];
  expect(obligation(c,s.terms,"Manufacturer")?.eligible).toBe(false);
  expect(obligation(c,s.terms,"Client")?.cents).toBe(10000);
 });
 it("evaluates effective versions, formulary, UM, channel and reversed claims",()=>{
  const s=fixture("duplicate",anchor,"Quarterly"),c=s.claims[0];
  expect(obligation({...c,tier:3},s.terms,"Manufacturer")?.eligible).toBe(false);
  expect(obligation({...c,pa:false},s.terms,"Manufacturer")?.eligible).toBe(false);
  expect(obligation(s.claims[10],s.terms,"Manufacturer")?.cents).toBe(0);
  expect(obligation({...c,serviceAt:"2028-01-01"},s.terms,"Manufacturer")).toBeNull();
  const terms=s.terms.map(t=>({...t,channel:"Mail"}));expect(obligation(c,terms,"Client")).toBeNull();
 });
 it("returns not verified for missing or conflicting terms",()=>{
  for(const mode of ["missing","conflict"]){const {s,events}=settled("omitted");
   s.terms=mode==="missing"?s.terms.filter(t=>t.side!=="Client"):[...s.terms,s.terms[0]];
   const r=comparison(s,events,day(anchor,120));expect(r.glass.verified).toBe(false);expect(r.glass.entitlementCents).toBeNull();expect(r.recognizedBenefitCents).toBe(0);
  }
 });
 it("credits neither detection nor manufacturer acceptance as savings",()=>{
  const {s,events}=settled("omitted");
  for(const d of [60,75,90,119]){const r=comparison(s,events,day(anchor,d));expect(r.recognizedBenefitCents).toBe(0);expect(r.glass.topupCents).toBe(0);expect(r.glass.unexpectedGuaranteeCents).toBeNull();}
 });
 it("shows partial cash and open dispute before later recovery",()=>{
  const {s,events}=settled("underpayment");const r=comparison(s,events,day(anchor,90));
  expect(r.glass.receiptsCents).toBe(70000);expect(r.glass.collectionExposureCents).toBe(30000);expect(r.recognizedBenefitCents).toBe(0);
 });
 it("keeps normal payment delay out of losses and marks late receivables overdue",()=>{
  const s=fixture("timing",anchor,"Quarterly"),events=eventsForStage("test",s,0,null);
  const within=position(s,events,"Glass",day(anchor,120));expect(within.operationalLossCents).toBe(0);expect(within.overdueCents).toBe(0);
  expect(position(s,events,"Glass",day(anchor,121)).overdueCents).toBe(100000);
 });
 it.each(["benefit","duplicate"])("rejected %s correction earns no benefit",id=>{
  const {result:r}=settled(id,"Rejected");expect(r.recognizedBenefitCents).toBe(0);expect(r.glass.operationalLossCents).toBe(r.baseline.operationalLossCents);
 });
 it("does not double-count a recovery and guarantee reduction",()=>{
  const {result:r}=settled("underpayment");expect(r.incrementalReceiptsCents).toBe(30000);expect(r.guaranteeReductionCents).toBe(30000);expect(r.recognizedBenefitCents).toBe(30000);
 });
 it("does not offset excess rebates in one monthly period against another",()=>{
  const s=fixture("omitted",anchor,"Monthly");const events:Event[]=[...eventsForStage("test",s,0,null),{id:"receipt",path:"Glass",kind:"Receipt",claimId:s.claims[0].id,termId:"manufacturer-v1",evidenceId:null,amountCents:80000,serviceAt:s.claims[0].serviceAt,recordedAt:day(anchor,120),settledAt:day(anchor,120),detail:"January receipts"}];
  expect(position(s,events,"Glass",day(anchor,120)).entitlementCents).toBe(130000);
 });
 it("has unique ledger identifiers and deterministically repeats",()=>{
  const {s,events}=settled("duplicate");expect(new Set(events.map(e=>e.id)).size).toBe(events.length);
  expect(eventsForStage("test",s,3,"Approved")).toEqual(eventsForStage("test",s,3,"Approved"));
 });
});
