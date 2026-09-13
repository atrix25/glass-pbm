/**
 * Escalation must remove latent Approved coverage from the adjudication world,
 * not merely flag the row. loadWorld selects determination=Approved; leaving
 * that column set after Escalate keeps specialty fills payable at POS.
 */

import { describe, expect, it } from "vitest";
import { escalationClearance } from "@/lib/pa/review";

type ApprovedPA = {
  drugId: string;
  effectiveDate: Date;
  terminationDate: Date | null;
};

/** Mirrors the loadWorld filter that feeds POS / reproduce / replay. */
function approvedPAsFromRows(
  rows: Array<{
    memberId: string;
    drugId: string;
    determination: string | null;
    approvedEffectiveDate: Date | null;
    approvedTerminationDate: Date | null;
  }>,
): Map<string, ApprovedPA[]> {
  const approvedPAs = new Map<string, ApprovedPA[]>();
  for (const pa of rows) {
    if (pa.determination !== "Approved") continue;
    if (!pa.approvedEffectiveDate) continue;
    const list = approvedPAs.get(pa.memberId) ?? [];
    list.push({
      drugId: pa.drugId,
      effectiveDate: pa.approvedEffectiveDate,
      terminationDate: pa.approvedTerminationDate,
    });
    approvedPAs.set(pa.memberId, list);
  }
  return approvedPAs;
}

function covers(
  pas: ApprovedPA[],
  drugId: string,
  dos: Date,
): boolean {
  return pas.some(
    (pa) =>
      pa.drugId === drugId &&
      pa.effectiveDate <= dos &&
      (!pa.terminationDate || pa.terminationDate >= dos),
  );
}

describe("escalation vs POS coverage", () => {
  const memberId = "m-specialty";
  const drugId = "d-skyrizi";
  const effective = new Date("2026-06-16T12:00:00Z");
  const decidedAt = new Date("2026-06-18T18:00:00Z");
  const dosAfterEscalate = new Date("2026-06-19T09:00:00Z");

  const latentApproved = {
    memberId,
    drugId,
    determination: "Approved" as const,
    approvedEffectiveDate: effective,
    approvedTerminationDate: new Date("2027-06-16T12:00:00Z"),
    decidedAt,
  };

  it("uncleared Escalate leaves specialty coverage on the adjudication world", () => {
    // Old decide route: only escalated + status flip.
    const afterBuggyEscalate = {
      ...latentApproved,
      escalated: true,
      status: "InReview",
      // determination / approvedEffectiveDate left intact
    };
    const world = approvedPAsFromRows([afterBuggyEscalate]);
    expect(covers(world.get(memberId) ?? [], drugId, dosAfterEscalate)).toBe(
      true,
    );
  });

  it("escalationClearance removes the row from Approved coverage", () => {
    const cleared = escalationClearance("Criteria unresolved.");
    const afterEscalate = {
      memberId,
      drugId,
      determination: cleared.determination,
      approvedEffectiveDate: cleared.approvedEffectiveDate,
      approvedTerminationDate: cleared.approvedTerminationDate,
    };
    const world = approvedPAsFromRows([afterEscalate]);
    expect(world.has(memberId)).toBe(false);
    expect(covers(world.get(memberId) ?? [], drugId, dosAfterEscalate)).toBe(
      false,
    );
  });
});
