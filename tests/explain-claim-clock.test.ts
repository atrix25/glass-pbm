/**
 * The claim ledger and claim detail are clock-cut. The member agent's
 * explainClaim tool must use the same cut, or pinning early lets the agent
 * narrate dollars and reject reasons for fills that have not been submitted
 * yet — including when getClaims no longer lists those ids.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveClock } from "@/lib/clock";

describe("explainClaim visibility as of the simulation clock", () => {
  const fills = [
    {
      id: "jan",
      claimNumber: "CLM-1",
      dateOfService: new Date("2026-01-15T00:00:00.000Z"),
    },
    {
      id: "mar",
      claimNumber: "CLM-2",
      dateOfService: new Date("2026-03-10T00:00:00.000Z"),
    },
    {
      id: "sep",
      claimNumber: "CLM-3",
      dateOfService: new Date("2026-09-01T00:00:00.000Z"),
    },
  ];

  it("hides future claim ids and numbers from explainClaim lookup", () => {
    const clock = resolveClock("2026-03-15T12:00:00.000Z");
    const visible = fills.filter(
      (c) => c.dateOfService.getTime() <= clock.today.getTime(),
    );
    expect(visible.map((c) => c.id)).toEqual(["jan", "mar"]);

    const byIdOrNumber = (claimId: string) =>
      visible.find((c) => c.id === claimId || c.claimNumber === claimId) ??
      null;

    expect(byIdOrNumber("CLM-2")?.id).toBe("mar");
    expect(byIdOrNumber("sep")).toBeNull();
    expect(byIdOrNumber("CLM-3")).toBeNull();
  });
});

describe("explainClaim wiring", () => {
  it("cuts lookup at getClock().today, matching getClaimDetail", () => {
    const source = readFileSync("src/lib/agent/tools.ts", "utf8");
    const start = source.indexOf("export async function explainClaim");
    const end = source.indexOf("export const checkCoverageSchema", start);
    const fn = source.slice(start, end);
    expect(fn).toContain("getClock");
    expect(fn).toContain("clock.today");
    expect(fn).toContain("dateOfService: { lte: clock.today }");
  });
});
