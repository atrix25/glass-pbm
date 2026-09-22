import { afterEach, describe, expect, it, vi } from "vitest";
const answerMember = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agents/member-service/agent", () => ({ answerMember }));
import { POST } from "@/app/api/member-calls/route";
import { MEMBER_CALL_SCENARIOS, scenarioMemberId } from "@/lib/member-call-scenarios";
import { DEMO_MEMBER_STORIES } from "@/lib/demo-members";
import { clinicalRefusal, compose } from "@/lib/agent/compose";

const request = (value: unknown) => new Request("http://localhost/api/member-calls", { method: "POST", body: JSON.stringify(value) });
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe("member call simulation", () => {
  it("does not expose simulations outside demo mode", async () => {
    vi.stubEnv("DEMO_FEATURES", "0");
    expect((await POST(request({}))).status).toBe(404);
    expect(answerMember).not.toHaveBeenCalled();
  });
  it.each([{ memberId: "real-member", question: "Coverage" }, { memberId: DEMO_MEMBER_STORIES[0].id, question: " " }, { memberId: DEMO_MEMBER_STORIES[0].id, question: "x".repeat(2001) }])("rejects invalid input %j", async input => {
    vi.stubEnv("DEMO_FEATURES", "1");
    expect((await POST(request(input))).status).toBe(400);
    expect(answerMember).not.toHaveBeenCalled();
  });
  it("runs tools without recording work or offering a nonexistent run link", async () => {
    vi.stubEnv("DEMO_FEATURES", "1");
    answerMember.mockResolvedValue({ runId: "not-persisted", paragraphs: ["A sourced answer"], handoffPacket: { suggestedOwner: "Member services" } });
    const input = { memberId: DEMO_MEMBER_STORIES[0].id, question: "Coverage" };
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    expect(answerMember).toHaveBeenCalledWith({ ...input, persist: false });
    expect(await response.json()).not.toHaveProperty("runId");
  });
  it("returns a retryable error without leaking internal data", async () => {
    vi.stubEnv("DEMO_FEATURES", "1");
    answerMember.mockRejectedValue(new Error("private database details"));
    const response = await POST(request({ memberId: DEMO_MEMBER_STORIES[0].id, question: "Coverage" }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("database");
  });
  it("uses only synthetic members and exercises the clinical refusal", () => {
    for (const scenario of MEMBER_CALL_SCENARIOS) {
      expect(DEMO_MEMBER_STORIES.some(m => m.id === scenarioMemberId(scenario.id))).toBe(true);
      expect(scenario.questions.length).toBeGreaterThan(0);
    }
    expect(clinicalRefusal(MEMBER_CALL_SCENARIOS.at(-1)!.questions[0])).toBeTruthy();
  });
});

// Historical determinations must not promise current coverage.
it("reports historical authorization without claiming it is active today", () => {
  const result = compose("Was my Skyrizi authorization approved?", "pa-status", [{
    tool: "getPriorAuthStatus", args: {}, because: "Check records", error: null,
    result: { data: { requests: [{ determination: "Approved", drug: "SKYRIZI", approvedThrough: "2026-05-19" }] }, citations: [], summary: "Historical approval" },
  }]);
  expect(result.paragraphs.join(" ")).toContain("was approved through 2026-05-19");
  expect(result.paragraphs.join(" ")).not.toContain("is approved");
  expect(result.paragraphs.join(" ")).toContain("do not confirm an active authorization");
});
