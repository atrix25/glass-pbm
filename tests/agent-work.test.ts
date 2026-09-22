import { describe, it, expect } from "vitest";
import { proposalStatus, parseWorkFilters, workDestination, nextStep, type ProposalRecord } from "../src/lib/agents/work";
const at=new Date("2026-09-01T00:00:00Z");
const before=new Date("2026-08-01T00:00:00Z");
const after=new Date("2026-10-01T00:00:00Z");
const base:ProposalRecord={status:"Proposed",createdAt:before,reviewedAt:null,appliedAt:null};
describe("recorded agent work",()=>{
 it("counts unresolved proposals independently of run outcome or consequence",()=>{
  expect(proposalStatus(base,at)).toBe("Awaiting review");
  const proposals=[base,{...base,status:"Applied",appliedAt:before},{...base,status:"Approved",reviewedAt:before}];
  expect(proposals.map(p=>proposalStatus(p,at))).toEqual(["Awaiting review","Applied","Awaiting action"]);
 });
 it.each(["Rejected","Withdrawn"])("keeps %s distinct when a dated decision supports it",status=>{
  expect(proposalStatus({...base,status,reviewedAt:before},at)).toBe(status);
  expect(proposalStatus({...base,status},at)).toBe("Status unavailable");
 });
 it("does not invent historical states or expose future decisions",()=>{
  expect(proposalStatus({...base,status:"Applied",appliedAt:after},at)).toBe("Status unavailable");
  expect(proposalStatus({...base,status:"Rejected",reviewedAt:after},at)).toBe("Status unavailable");
  expect(proposalStatus({...base,createdAt:after},at)).toBe("Status unavailable");
 });
 it("fails closed on missing or conflicting application and review records",()=>{
  expect(proposalStatus({...base,status:"Applied"},at)).toBe("Status unavailable");
  expect(proposalStatus({...base,status:"Approved",appliedAt:before,reviewedAt:before},at)).toBe("Status unavailable");
  expect(proposalStatus({...base,reviewedAt:before},at)).toBe("Status unavailable");
 });
 it("includes events exactly at the cutoff",()=>{
  expect(proposalStatus({...base,status:"Applied",appliedAt:at},at)).toBe("Applied");
 });
 it("defaults to unresolved work and bounds untrusted pagination",()=>{
  expect(parseWorkFilters({})).toMatchObject({status:"Unresolved",page:1,q:""});
  expect(parseWorkFilters({status:"bad",page:"-4",q:"  test  "})).toMatchObject({status:"Unresolved",page:1,q:"test"});
  expect(parseWorkFilters({page:"Infinity"}).page).toBe(1000000);
  expect(parseWorkFilters({page:["3"]}).page).toBe(1);
 });
 it("does not claim assignment or a specific unsupported record link",()=>{
  expect(workDestination("pa-intake","PriorAuthorization","pa/1")).toEqual({href:"/pa/pa%2F1",label:"Open request"});
  expect(workDestination("eligibility-resolver",null,null)).toEqual({href:"/eligibility",label:"Open work queue"});
  expect(workDestination("unknown").href).toBe("/agents");
  expect(nextStep("Completed")).toContain("does not confirm");
  expect(nextStep("Escalated")).toContain("not recorded");
 });
});
