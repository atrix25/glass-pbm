/**
 * DAW-1 brand selection penalty must use a generic equivalent cost, not the
 * brand NDC's own NADAC. The Certificate of Coverage charges the difference
 * between the brand and the generic; using brand NADAC under-charges by the
 * brand–generic differential on every DAW-1 fill.
 */

import { describe, expect, it } from "vitest";
import {
  adjudicate,
  attachGenericEquivalentNadac,
  resolveGenericReferenceMicros,
} from "@/lib/engine/adjudicate";
import {
  DEFAULT_ASSUMPTIONS,
  deriveUnitPrices,
  extendPrices,
} from "@/lib/engine/benchmark";
import { fromCents, subtract, toCents } from "@/lib/money";
import { drug, entry, makeContext } from "./fixtures";

describe("resolveGenericReferenceMicros", () => {
  it("returns 0 for a brand with no generic equivalent on file", () => {
    const brand = drug({
      isBrandLabel: true,
      monyCode: "M",
      nadacPerUnit: 10,
    });
    expect(
      resolveGenericReferenceMicros({
        brandGeneric: "Brand",
        drug: brand,
        quantityDispensed: 30,
      }),
    ).toBe(0);
  });

  it("prices the reference off the generic NADAC (MAC when applicable), not the brand NADAC", () => {
    const brand = drug({
      isBrandLabel: true,
      monyCode: "M",
      nadacPerUnit: 10,
      genericEquivalentNadacPerUnit: 1,
    });
    const ref = resolveGenericReferenceMicros({
      brandGeneric: "Brand",
      drug: brand,
      quantityDispensed: 30,
    });
    const expected = extendPrices(
      deriveUnitPrices(
        `generic-ref:${brand.ndc11}`,
        1,
        false,
        DEFAULT_ASSUMPTIONS,
        false,
      ),
      30,
    );
    expect(ref).toBe(expected.macMicros ?? expected.nadacMicros);

    const brandOwnNadac = extendPrices(
      deriveUnitPrices(brand.ndc11, 10, true, DEFAULT_ASSUMPTIONS, false),
      30,
    ).nadacMicros;
    expect(ref).toBeLessThan(brandOwnNadac);
  });
});

describe("attachGenericEquivalentNadac", () => {
  it("wires each brand to the cheapest same-molecule generic", () => {
    const brand = {
      isBrandLabel: true,
      molecule: "atorvastatin",
      nadacPerUnit: 12,
      genericEquivalentNadacPerUnit: null as number | null,
    };
    const cheap = {
      isBrandLabel: false,
      molecule: "atorvastatin",
      nadacPerUnit: 0.4,
      genericEquivalentNadacPerUnit: null as number | null,
    };
    const dear = {
      isBrandLabel: false,
      molecule: "atorvastatin",
      nadacPerUnit: 0.9,
      genericEquivalentNadacPerUnit: null as number | null,
    };
    const other = {
      isBrandLabel: false,
      molecule: "metformin",
      nadacPerUnit: 0.1,
      genericEquivalentNadacPerUnit: null as number | null,
    };
    attachGenericEquivalentNadac([brand, cheap, dear, other]);
    expect(brand.genericEquivalentNadacPerUnit).toBe(0.4);
    expect(cheap.genericEquivalentNadacPerUnit).toBeNull();
  });
});

describe("DAW-1 brand selection penalty at adjudication", () => {
  it("does not invent a penalty from the brand's own NADAC", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({
          isBrandLabel: true,
          monyCode: "M",
          nadacPerUnit: 8,
          // No genericEquivalentNadacPerUnit — old code used brand NADAC here.
        }),
        formularyEntry: entry({ level: "3" }),
        dawCode: "1",
        quantityDispensed: 30,
        daysSupply: 30,
      }),
    );

    expect(out.responseStatus).toBe("P");
    expect(out.brandSelectionPenaltyCents).toBe(0);
  });

  it("charges the brand-minus-generic difference when an equivalent is on file", () => {
    const brand = drug({
      isBrandLabel: true,
      monyCode: "M",
      nadacPerUnit: 10,
      genericEquivalentNadacPerUnit: 1,
    });
    const out = adjudicate(
      makeContext({
        drug: brand,
        formularyEntry: entry({ level: "3" }),
        dawCode: "1",
        quantityDispensed: 30,
        daysSupply: 30,
      }),
    );

    expect(out.responseStatus).toBe("P");
    expect(out.brandSelectionPenaltyCents).toBeGreaterThan(0);

    const genericRef = resolveGenericReferenceMicros({
      brandGeneric: "Brand",
      drug: brand,
      quantityDispensed: 30,
    });
    const expectedPenalty = toCents(
      subtract(fromCents(out.totalBilledCents), genericRef),
    );
    // Penalty is brand allowed − generic reference; Level 3 also adds 40%
    // coinsurance, so patient pay exceeds the penalty alone.
    expect(out.brandSelectionPenaltyCents).toBe(expectedPenalty);
    expect(out.patientPayCents).toBeGreaterThanOrEqual(
      out.brandSelectionPenaltyCents,
    );

    // Sanity: the wrongly-computed "brand NADAC" reference would have produced
    // a much smaller penalty (≈ AWP spread), well under the true differential.
    const brandNadacRef = extendPrices(
      deriveUnitPrices(brand.ndc11, 10, true, DEFAULT_ASSUMPTIONS, false),
      30,
    ).nadacMicros;
    const wrongPenalty = toCents(
      subtract(fromCents(out.totalBilledCents), brandNadacRef),
    );
    expect(out.brandSelectionPenaltyCents).toBeGreaterThan(wrongPenalty);
  });
});
