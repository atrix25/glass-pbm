import { beforeEach, describe, expect, it, vi } from "vitest";
const db=vi.hoisted(()=>({
 $queryRaw:vi.fn(),
 rebateSandboxRun:{findUnique:vi.fn(),findFirst:vi.fn(),create:vi.fn(),update:vi.fn()},
 rebateSandboxEvent:{create:vi.fn(),createMany:vi.fn()},
 rebateSandboxException:{create:vi.fn()},
}));
vi.mock("@/lib/db",()=>({prisma:{...db,$transaction:(fn:(t:typeof db)=>unknown)=>fn(db)}}));
import { advanceSimulation, createSimulation, reviewSimulation, simulation } from "@/lib/rebate-protection/service";
import { fixture, eventsForStage } from "@/lib/rebate-protection/scenarios";
import { day } from "@/lib/rebate-protection/model";
const anchor="2026-01-01T00:00:00.000Z",clock=new Date(day(anchor,120));
const base=(scenario="benefit",stage=1)=>({id:"rbp_test",tenantId:"steel-potatoes",snapshot:JSON.stringify(fixture(scenario,anchor,"Quarterly")),scenarioId:scenario,stage,decision:null,reviewer:null,reviewedAt:null,createdAt:new Date(),events:[],exceptions:[]});
beforeEach(()=>{vi.resetAllMocks();db.rebateSandboxRun.findFirst.mockResolvedValue(base());});
describe("isolated sandbox persistence",()=>{
 it("requires review before accepting consequential changes",async()=>{
  await expect(advanceSimulation("rbp_test",1,clock)).rejects.toThrow("simulated review");expect(db.rebateSandboxEvent.createMany).not.toHaveBeenCalled();
 });
 it("records review with explicit sandbox identity and is idempotent",async()=>{
  await reviewSimulation("rbp_test","Approved","Simulated Finance reviewer",clock);
  expect(db.rebateSandboxEvent.create.mock.calls[0][0].data.detail).toContain("Sandbox decision only");
  db.rebateSandboxRun.findFirst.mockResolvedValue({...base(),decision:"Approved"});
  await reviewSimulation("rbp_test","Approved","Simulated Finance reviewer",clock);
  expect(db.rebateSandboxRun.update).toHaveBeenCalledTimes(1);
  await expect(reviewSimulation("rbp_test","Rejected","Reviewer",clock)).rejects.toThrow("different simulated");
 });
 it("does not replay or skip transition writes",async()=>{
  db.rebateSandboxRun.findFirst.mockResolvedValue(base("omitted",2));
  await advanceSimulation("rbp_test",1,clock);expect(db.rebateSandboxEvent.createMany).not.toHaveBeenCalled();
  db.rebateSandboxRun.findFirst.mockResolvedValue(base("omitted",0));
  await expect(advanceSimulation("rbp_test",2,clock)).rejects.toThrow("Refresh");
 });
 it("rejects advancement and review beyond selected cutoff",async()=>{
  db.rebateSandboxRun.findFirst.mockResolvedValue(base("omitted",1));
  await expect(advanceSimulation("rbp_test",1,new Date(day(anchor,80)))).rejects.toThrow("cutoff");
  db.rebateSandboxRun.findFirst.mockResolvedValue(base());
  await expect(reviewSimulation("rbp_test","Approved","Reviewer",new Date(day(anchor,70)))).rejects.toThrow("cutoff");
 });
 it("preserves the frozen snapshot and writes only sandbox tables",async()=>{
  db.rebateSandboxRun.findUnique.mockResolvedValue(null);
  const id=await createSimulation("omitted","Quarterly","request-key",clock);
  expect(id.startsWith("rbp_")).toBe(true);
  const stored=db.rebateSandboxRun.create.mock.calls[0][0].data;
  expect(JSON.parse(stored.snapshot).forecast.frozenAt).toBe(anchor);
  expect(db.rebateSandboxEvent.createMany).toHaveBeenCalledTimes(1);
  expect(db.rebateSandboxException.create).toHaveBeenCalledTimes(1);
  // No AgentRun, AgentProposal, Claim or payment table exists on this transaction mock.
 });
 it("returns the original run for duplicate create; rejects changed inputs",async()=>{
  db.rebateSandboxRun.findUnique.mockResolvedValue(base("omitted",0));
  expect(await createSimulation("omitted","Quarterly","key",clock)).toBe("rbp_test");
  expect(db.rebateSandboxRun.create).not.toHaveBeenCalled();
  await expect(createSimulation("omitted","Monthly","key",clock)).rejects.toThrow("different inputs");
 });
 it("hides future decisions, receipts and exception history",async()=>{
  const s=fixture("benefit",anchor,"Quarterly"),record=base();
  const events=[0,1,2,3].flatMap(stage=>eventsForStage("rbp_test",s,stage,"Approved")).map(e=>({...e,serviceAt:new Date(e.serviceAt),recordedAt:new Date(e.recordedAt),settledAt:e.settledAt?new Date(e.settledAt):null,createdAt:new Date()}));
  db.rebateSandboxRun.findFirst.mockResolvedValue({...record,stage:3,decision:"Approved",reviewer:"Reviewer",reviewedAt:new Date(day(anchor,80)),events});
  const past=await simulation("rbp_test",clock,day(anchor,75));
  expect(past?.decision).toBeNull();expect(past?.reviewer).toBeNull();expect(past?.events.every(e=>e.recordedAt<=day(anchor,75))).toBe(true);expect(past?.result.recognizedBenefitCents).toBe(0);
  const before=await simulation("rbp_test",clock,day(anchor,20));expect(before?.stage).toBe(-1);expect(before?.result.glass.entitlementCents).toBeNull();
 });
 it("scopes every lookup to the configured sponsor",async()=>{
  await reviewSimulation("rbp_test","Approved","Reviewer",clock);
  expect(db.rebateSandboxRun.findFirst.mock.calls[0][0].where).toEqual({id:"rbp_test",tenantId:"steel-potatoes"});
 });
});
