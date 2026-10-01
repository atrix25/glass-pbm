import { describe, expect, it } from "vitest";
import {
  dailyMme,
  mmeBand,
  MME_THRESHOLDS,
  NON_CONVERTIBLE,
  parseOpioid,
} from "@/lib/clinical/opioids";

describe("parseOpioid", () => {
  it("records non-convertible opioid products without inventing an MME factor", () => {
    for (const [molecule, reason] of Object.entries(NON_CONVERTIBLE)) {
      const parsed = parseOpioid(`${molecule.toUpperCase()} 8 MG TABLET`);

      expect(parsed).toMatchObject({
        molecule,
        strengthMg: 8,
        mmeFactor: 0,
        convertible: false,
        exclusionReason: reason,
      });
    }
  });

  it("parses ordinary solids, brands, liquids, patches, and combinations", () => {
    expect(parseOpioid("OXYCODONE 10 MG TABLET")).toMatchObject({
      molecule: "oxycodone",
      strengthMg: 10,
      isTransdermal: false,
      convertible: true,
    });
    expect(parseOpioid("OXYCONTIN 20 MG TABLET")?.molecule).toBe("oxycodone");
    expect(parseOpioid("HYDROCODONE-ACETAMINOPHEN 10-300 MG")?.strengthMg).toBe(
      10,
    );
    expect(parseOpioid("MORPHINE SULFATE 10 MG/5 ML")?.strengthMg).toBe(2);
    expect(parseOpioid("FENTANYL 100 MCG/HR PATCH")).toMatchObject({
      molecule: "fentanyl",
      strengthMg: 100,
      isTransdermal: true,
    });
  });

  it("returns null for an unknown or unparseable description", () => {
    expect(parseOpioid("AMOXICILLIN 500 MG CAPSULE")).toBeNull();
    expect(parseOpioid("MORPHINE TABLET")).toBeNull();
  });
});

describe("dailyMme", () => {
  it("uses the patch rate, returns zero for invalid supply, and spreads oral dose", () => {
    expect(
      dailyMme({
        quantityDispensed: 10,
        daysSupply: 30,
        strengthMg: 10,
        mmeFactor: 1.5,
        isTransdermal: false,
      }),
    ).toBe(5);
    expect(
      dailyMme({
        quantityDispensed: 10,
        daysSupply: 0,
        strengthMg: 10,
        mmeFactor: 1,
        isTransdermal: false,
      }),
    ).toBe(0);
    expect(
      dailyMme({
        quantityDispensed: 1,
        daysSupply: 30,
        strengthMg: 100,
        mmeFactor: 2.4,
        isTransdermal: true,
      }),
    ).toBe(240);
  });
});

describe("mmeBand", () => {
  it("uses the threshold boundaries exactly", () => {
    expect(mmeBand(MME_THRESHOLDS.reassess - 0.01)).toBe("none");
    expect(mmeBand(MME_THRESHOLDS.reassess)).toBe("reassess");
    expect(mmeBand(MME_THRESHOLDS.avoidOrJustify - 0.01)).toBe("reassess");
    expect(mmeBand(MME_THRESHOLDS.avoidOrJustify)).toBe("high");
  });
});
