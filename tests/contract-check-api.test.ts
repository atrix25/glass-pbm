import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({selectedSponsor:vi.fn(),authenticatedStaff:vi.fn(),getClock:vi.fn(),saveCheck:vi.fn(),readCheck:vi.fn()}));
vi.mock("@/lib/contract-checks/context",()=>({selectedSponsor:mocks.selectedSponsor}));
vi.mock("@/lib/contract-checks/access",()=>({authenticatedStaff:mocks.authenticatedStaff,sameOrigin:(r:Request)=>r.headers.get("origin")==="http://localhost"}));
vi.mock("@/lib/contract-checks/service",()=>({saveCheck:mocks.saveCheck,readCheck:mocks.readCheck}));
vi.mock("@/lib/session",()=>({getClock:mocks.getClock}));
import { POST,GET } from "@/app/api/contract-checks/route";
import { POST as selectSponsor } from "@/app/api/demo-sponsor/route";
const req=(body:unknown,origin="http://localhost")=>new Request("http://localhost/api/contract-checks",{method:"POST",headers:{origin},body:JSON.stringify(body)});
const body={cutoff:"2023-03-31T00:00:00.000Z",key:"abc12345-1234-4123-8123-123456789012"};
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv("DEMO_FEATURES","1");mocks.selectedSponsor.mockResolvedValue("tennessee");mocks.authenticatedStaff.mockResolvedValue(true);mocks.getClock.mockResolvedValue({now:new Date("2026-09-01")});mocks.saveCheck.mockResolvedValue({id:"cck_test"});});
afterEach(()=>vi.unstubAllEnvs());
it("gates the selector and checks behind demo mode",async()=>{vi.stubEnv("DEMO_FEATURES","0");expect((await POST(req(body))).status).toBe(404);expect((await selectSponsor(req({sponsor:"tennessee"}))).status).toBe(404);});
it("uses server sponsor context and rejects caller-supplied sponsor",async()=>{
 expect((await POST(req(body))).status).toBe(200);expect(mocks.saveCheck).toHaveBeenCalledWith("tennessee",body.cutoff,body.key);
 expect((await POST(req({...body,sponsor:"wisconsin"}))).status).toBe(400);
});
it("rejects unauthenticated session users and foreign origins",async()=>{
 expect((await POST(req(body,"http://elsewhere"))).status).toBe(403);mocks.authenticatedStaff.mockResolvedValue(false);expect((await POST(req(body))).status).toBe(403);expect((await GET(new Request("http://localhost/api/contract-checks?id=cck_test"))).status).toBe(403);
});
it("rejects future cutoffs",async()=>{expect((await POST(req({...body,cutoff:"2027-01-01T00:00:00.000Z"}))).status).toBe(400);});
it("scopes reads to the active sponsor and hides absent records",async()=>{
 mocks.readCheck.mockResolvedValue(null);expect((await GET(new Request("http://localhost/api/contract-checks?id=cck_other"))).status).toBe(404);expect(mocks.readCheck).toHaveBeenCalledWith("cck_other","tennessee");
});
it("sets a validated HTTP-only sponsor cookie",async()=>{
 expect((await selectSponsor(req({sponsor:"bogus"}))).status).toBe(400);const r=await selectSponsor(req({sponsor:"tennessee"}));expect(r.headers.get("set-cookie")).toContain("glass_demo_sponsor=tennessee");expect(r.headers.get("set-cookie")).toContain("HttpOnly");
});
