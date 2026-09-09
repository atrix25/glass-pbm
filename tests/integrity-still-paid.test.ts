/**
 * Integrity surveillance must not treat a reversed B1 as still paid.
 *
 * B2s leave the original fill marked `P`. Detectors and the triage agent that
 * filter on paid status alone still see the undone fill — concurrent MME,
 * shopping breadth, and early-refill overlaps that remittance already erased.
 * The scripted SIU path fires when overlaps ≥ 3 on a High member signal; a
 * reversed opioid in that window can manufacture the referral.
 */

import { describe, expect, it } from "vitest";
import {
  claimIdsReversedBy,
  notReversedSql,
} from "@/lib/integrity/still-paid";

describe("claimIdsReversedBy", () => {
  it("collects B1 ids pointed at by posted B2s", () => {
    expect(
      claimIdsReversedBy([
        { reversalOfClaimId: "b1-a" },
        { reversalOfClaimId: null },
        { reversalOfClaimId: "b1-b" },
      ]),
    ).toEqual(["b1-a", "b1-b"]);
  });

  it("returns an empty list when nothing has been reversed", () => {
    expect(claimIdsReversedBy([{ reversalOfClaimId: null }])).toEqual([]);
  });
});

describe("notReversedSql", () => {
  it("anchors the NOT EXISTS subquery on the claim alias", () => {
    const sql = notReversedSql("c");
    expect(sql).toMatch(/NOT EXISTS/);
    expect(sql).toMatch(/r\.reversalOfClaimId = c\.id/);
    expect(sql).toMatch(/r\.transactionCode = 'B2'/);
  });
});

/**
 * The overlap rule the triage agent uses to invent early-refill evidence.
 * Kept here so a regression that re-admits reversed fills into the timeline
 * still has to clear the same threshold the scripted SIU path cares about.
 */
function overlappingSameMolecule(
  fills: Array<{ molecule: string; dateOfService: Date; daysSupply: number }>,
): number {
  let overlaps = 0;
  const byMolecule = new Map<string, typeof fills>();
  for (const f of fills) {
    byMolecule.set(f.molecule, [...(byMolecule.get(f.molecule) ?? []), f]);
  }
  for (const [, list] of byMolecule) {
    for (let i = 1; i < list.length; i++) {
      const prevEnd =
        list[i - 1].dateOfService.getTime() +
        list[i - 1].daysSupply * 86_400_000;
      if (list[i].dateOfService.getTime() < prevEnd - 3 * 86_400_000) {
        overlaps++;
      }
    }
  }
  return overlaps;
}

describe("early-refill overlaps after dropping reversed fills", () => {
  it("no longer reaches the SIU threshold once the undone fill is excluded", () => {
    const day = (n: number) => new Date(Date.UTC(2026, 0, n));
    // Three early overlaps depend on the middle (reversed) fill. Without it,
    // consecutive windows fall to two overlaps — below the scripted SIU bar.
    const withReversed = [
      { molecule: "oxycodone", dateOfService: day(1), daysSupply: 30 },
      { molecule: "oxycodone", dateOfService: day(8), daysSupply: 30 }, // reversed
      { molecule: "oxycodone", dateOfService: day(15), daysSupply: 30 },
      { molecule: "oxycodone", dateOfService: day(45), daysSupply: 30 },
      { molecule: "oxycodone", dateOfService: day(70), daysSupply: 30 },
    ];
    expect(overlappingSameMolecule(withReversed)).toBeGreaterThanOrEqual(3);

    const stillPaid = withReversed.filter((_, i) => i !== 1);
    expect(overlappingSameMolecule(stillPaid)).toBeLessThan(3);
  });
});
