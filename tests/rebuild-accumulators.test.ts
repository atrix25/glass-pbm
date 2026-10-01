/**
 * Reproduce/POS must rebuild the same accumulator prefix seed and replay fold
 * from accumulatorDeltas. These pin the pure rebuild against the engine's own
 * delta math so a wrong formula cannot silently overcharge near a limit.
 */

import { describe, expect, it } from "vitest";
import { adjudicate } from "@/lib/engine/adjudicate";
import { rebuildPharmacyAccumulators } from "@/lib/engine/rebuild-accumulators";
import { drug, entry, makeContext, PLAN } from "./fixtures";

const rxOopLevels = new Set(
  PLAN.costShareRules.filter((r) => r.accumulatesToRxOop).map((r) => r.level),
);
const federalOopLevels = new Set(
  PLAN.costShareRules
    .filter((r) => r.accumulatesToFederalOop)
    .map((r) => r.level),
);

function seedAccumulatorsFromOutcome(
  outcome: ReturnType<typeof adjudicate>,
  acc = { rxOop: 0, federalOop: 0, deductible: 0 },
) {
  for (const d of outcome.costShare?.accumulatorDeltas ?? []) {
    const cents = Math.round(d.amountMicros / 10_000);
    if (d.accumulatorType === "RxOopIndividual") acc.rxOop += cents;
    if (d.accumulatorType === "FederalOopIndividual") acc.federalOop += cents;
    if (d.accumulatorType === "DeductibleIndividual") acc.deductible += cents;
  }
  return acc;
}

describe("rebuildPharmacyAccumulators matches seed/replay deltas", () => {
  it("credits full patient pay on Level 2 DAW-1, including the brand penalty", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 12, isBrandLabel: true }),
        formularyEntry: entry({ level: "2" }),
        quantityDispensed: 30,
        daysSupply: 30,
        dawCode: "1",
      }),
    );

    expect(out.responseStatus).toBe("P");
    expect(out.brandSelectionPenaltyCents).toBeGreaterThan(0);
    expect(out.patientPayCents).toBeGreaterThan(out.brandSelectionPenaltyCents);

    const seeded = seedAccumulatorsFromOutcome(out);
    const rebuilt = rebuildPharmacyAccumulators(
      [
        {
          formularyLevel: "2",
          patientPayCents: out.patientPayCents,
          appliedToDeductibleCents: out.appliedToDeductibleCents,
        },
      ],
      { rxOopLevels, federalOopLevels },
    );

    expect(rebuilt.rxOopCents).toBe(seeded.rxOop);
    expect(rebuilt.federalOopCents).toBe(seeded.federalOop);
    // The wrong formula (patient pay minus brand penalty) is what overcharges
    // the next fill near the Rx OOP limit.
    expect(rebuilt.rxOopCents).toBeGreaterThan(
      out.patientPayCents - out.brandSelectionPenaltyCents,
    );
  });

  it("credits Level 3 patient pay to federal OOP only, not Rx OOP", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 40, isBrandLabel: true }),
        formularyEntry: entry({ level: "3" }),
        quantityDispensed: 30,
        daysSupply: 30,
      }),
    );

    expect(out.responseStatus).toBe("P");
    expect(out.patientPayCents).toBeGreaterThan(0);

    const seeded = seedAccumulatorsFromOutcome(out);
    const rebuilt = rebuildPharmacyAccumulators(
      [
        {
          formularyLevel: "3",
          patientPayCents: out.patientPayCents,
          appliedToDeductibleCents: out.appliedToDeductibleCents,
        },
      ],
      { rxOopLevels, federalOopLevels },
    );

    expect(seeded.rxOop).toBe(0);
    expect(seeded.federalOop).toBe(out.patientPayCents);
    expect(rebuilt.rxOopCents).toBe(0);
    expect(rebuilt.federalOopCents).toBe(seeded.federalOop);
  });

  it("prevents an overcharge on the fill that crosses the Rx OOP limit", () => {
    const daw = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 12, isBrandLabel: true }),
        formularyEntry: entry({ level: "2" }),
        quantityDispensed: 30,
        daysSupply: 30,
        dawCode: "1",
      }),
    );
    expect(daw.brandSelectionPenaltyCents).toBeGreaterThan(0);

    // Leave only the brand-penalty gap under the $600 Rx OOP limit so the
    // wrong rebuild (which drops that gap) still thinks the full coinsurance
    // max is available.
    const seededRx =
      PLAN.rxOopLimitIndividual -
      daw.brandSelectionPenaltyCents -
      1_000; /* $10 headroom under the true seed position */
    const wrongRebuildRx = seededRx - daw.brandSelectionPenaltyCents;

    const nextDrug = drug({ nadacPerUnit: 12, isBrandLabel: true });
    const bookQuote = adjudicate(
      makeContext({
        drug: nextDrug,
        formularyEntry: entry({ level: "2" }),
        quantityDispensed: 30,
        daysSupply: 30,
        accumulators: {
          rxOopAccumulatedCents: seededRx,
          federalOopAccumulatedCents: seededRx,
          deductibleAccumulatedCents: 0,
        },
      }),
    );
    const buggyQuote = adjudicate(
      makeContext({
        drug: nextDrug,
        formularyEntry: entry({ level: "2" }),
        quantityDispensed: 30,
        daysSupply: 30,
        accumulators: {
          rxOopAccumulatedCents: wrongRebuildRx,
          federalOopAccumulatedCents: wrongRebuildRx,
          deductibleAccumulatedCents: 0,
        },
      }),
    );

    expect(bookQuote.patientPayCents).toBeLessThan(buggyQuote.patientPayCents);

    const rebuilt = rebuildPharmacyAccumulators(
      [
        {
          formularyLevel: "2",
          // Synthesize priors whose full patient pay sums to the seed position.
          patientPayCents: seededRx,
          appliedToDeductibleCents: 0,
        },
      ],
      { rxOopLevels, federalOopLevels },
    );
    expect(rebuilt.rxOopCents).toBe(seededRx);
  });
});
