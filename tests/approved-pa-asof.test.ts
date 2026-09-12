/**
 * Approvals whose decidedAt is still in the future must not waive a 75.
 *
 * Seed normally sets approvedEffectiveDate ≡ decidedAt. The June clinical-queue
 * incident then delays decidedAt alone, so a clock pin between the two would
 * otherwise let POS pay specialty while the live queue still says In review.
 */

import { describe, expect, it } from "vitest";
import { approvedPAsAsOf, type WorldApprovedPA } from "@/lib/engine/replay";

const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

const incidentSkewed: WorldApprovedPA = {
  drugId: "drug-skyrizi",
  // Original decision time — left alone by seed-incident.ts.
  effectiveDate: day("2026-06-15"),
  terminationDate: day("2026-10-15"),
  // Delayed by the incident stall (74–150 hours after receipt).
  decidedAt: day("2026-06-18"),
};

describe("approvedPAsAsOf", () => {
  it("hides an approval whose decision has not been released yet", () => {
    const asOf = day("2026-06-16");
    expect(asOf >= incidentSkewed.effectiveDate).toBe(true);
    expect(asOf < incidentSkewed.decidedAt).toBe(true);

    expect(approvedPAsAsOf([incidentSkewed], asOf)).toEqual([]);
  });

  it("releases the same approval once decidedAt has passed", () => {
    const asOf = day("2026-06-19");
    const visible = approvedPAsAsOf([incidentSkewed], asOf);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toEqual({
      drugId: "drug-skyrizi",
      effectiveDate: incidentSkewed.effectiveDate,
      terminationDate: incidentSkewed.terminationDate,
    });
  });

  it("keeps a normal approval where effectiveDate and decidedAt coincide", () => {
    const normal: WorldApprovedPA = {
      drugId: "drug-x",
      effectiveDate: day("2026-03-01"),
      terminationDate: day("2026-06-01"),
      decidedAt: day("2026-03-01"),
    };
    expect(approvedPAsAsOf([normal], day("2026-02-28"))).toEqual([]);
    expect(approvedPAsAsOf([normal], day("2026-03-01"))).toHaveLength(1);
  });
});
