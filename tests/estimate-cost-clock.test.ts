/**
 * Member cost quotes must use the simulation clock as the date of service.
 *
 * loadWorld() exposes every stored approvedEffectiveDate for the year. Pricing
 * with wall-clock DOS makes a mid-January pin treat a Jan-17 PA effective date
 * as already covering Skyrizi, while POS (clock.today) still rejects 75.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adjudicate } from "@/lib/engine/adjudicate";
import { resolveClock } from "@/lib/clock";
import { drug, entry, makeContext, SPECIALTY_PHARMACY } from "./fixtures";

describe("PA coverage is gated by quote date of service", () => {
  const d = drug({ nadacPerUnit: 300, isBrandLabel: true, isSpecialty: true });
  // David's demo PA: received day 15, decided ~+26h → effective ~Jan 17.
  const approvedPAs = [
    {
      drugId: d.id,
      effectiveDate: new Date("2026-01-17T02:00:00.000Z"),
      terminationDate: new Date("2026-05-17T02:00:00.000Z"),
    },
  ];

  it("rejects 75 when the pin is still before the approval effective date", () => {
    const clock = resolveClock("2026-01-16T12:00:00.000Z");
    const out = adjudicate(
      makeContext({
        drug: d,
        formularyEntry: entry({
          level: "4",
          requiresPA: true,
          mandatorySpecialty: true,
        }),
        pharmacy: SPECIALTY_PHARMACY,
        dateOfService: clock.today,
        approvedPAs,
      }),
    );
    expect(out.responseStatus).toBe("R");
    expect(out.rejectCodes).toContain("75");
  });

  it("pays once the pin reaches a day the approval covers", () => {
    const clock = resolveClock("2026-01-18T12:00:00.000Z");
    const out = adjudicate(
      makeContext({
        drug: d,
        formularyEntry: entry({
          level: "4",
          requiresPA: true,
          mandatorySpecialty: true,
        }),
        pharmacy: SPECIALTY_PHARMACY,
        dateOfService: clock.today,
        approvedPAs,
      }),
    );
    expect(out.responseStatus).toBe("P");
  });

  it("wall-clock DOS inside the approval window would wrongly pay under an early pin", () => {
    const pin = resolveClock("2026-01-16T12:00:00.000Z");
    // Real "today" while the demo is still pinned to the review window —
    // after effectiveDate, before terminationDate.
    const wall = new Date("2026-03-01T12:00:00.000Z");
    const againstPin = adjudicate(
      makeContext({
        drug: d,
        formularyEntry: entry({
          level: "4",
          requiresPA: true,
          mandatorySpecialty: true,
        }),
        pharmacy: SPECIALTY_PHARMACY,
        dateOfService: pin.today,
        approvedPAs,
      }),
    );
    const againstWall = adjudicate(
      makeContext({
        drug: d,
        formularyEntry: entry({
          level: "4",
          requiresPA: true,
          mandatorySpecialty: true,
        }),
        pharmacy: SPECIALTY_PHARMACY,
        dateOfService: wall,
        approvedPAs,
      }),
    );
    expect(againstPin.responseStatus).toBe("R");
    expect(againstWall.responseStatus).toBe("P");
  });
});

describe("estimateCost wiring", () => {
  it("prices against getClock().today, not wall new Date()", () => {
    const source = readFileSync("src/lib/agent/tools.ts", "utf8");
    const start = source.indexOf("export async function estimateCost");
    const end = source.indexOf("export async function getPriorAuthStatus", start);
    const fn = source.slice(start, end);
    expect(fn).toContain("getClock");
    expect(fn).toContain("clock.today");
    expect(fn).toContain("dateOfService: clock.today");
    expect(fn).not.toMatch(/dateOfService:\s*new Date\(\)/);
  });
});
