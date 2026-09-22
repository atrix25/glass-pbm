import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
afterEach(()=>vi.unstubAllEnvs());
it("keeps unrelated operational routes and APIs out of Tennessee",()=>{
 vi.stubEnv("DEMO_FEATURES","1");vi.stubEnv("AUTH_MODE","open");
 const r=(path:string)=>proxy(new NextRequest(`http://localhost${path}`,{headers:{cookie:"glass_demo_sponsor=tennessee"}}));
 expect(r("/claims").headers.get("location")).toBe("http://localhost/rebate-protection");expect(r("/api/rebate-protection").status).toBe(409);expect(r("/api/contract-checks").headers.get("x-middleware-next")).toBe("1");expect(r("/sponsor").headers.get("x-middleware-next")).toBe("1");
});
it("does not bypass authentication when selecting a sponsor",()=>{
 vi.stubEnv("DEMO_FEATURES","1");vi.stubEnv("AUTH_MODE","basic");vi.stubEnv("DEMO_PASSWORD","secret-test");
 expect(proxy(new NextRequest("http://localhost/api/contract-checks",{headers:{cookie:"glass_demo_sponsor=tennessee"}})).status).toBe(401);
});
