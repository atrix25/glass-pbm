/**
 * CoC §F Level 3 row: DAW-1 adds the brand/generic cost difference only on
 * Level 3. §M covers a DAW brand at whatever formulary tier it already sits
 * on — Level 1, 2, and 4 keep ordinary cost share with no differential.
 */

import { describe, expect, it } from "vitest";
import { adjudicate } from "@/lib/engine/adjudicate";
import { drug, entry, makeContext, SPECIALTY_PHARMACY } from "./fixtures";

function brandFill(level: string, dawCode: string) {
  return adjudicate(
    makeContext({
      // Multi-source originator brand so DAW-1 stays classified Brand.
      drug: drug({
        nadacPerUnit: 20,
        isBrandLabel: true,
        monyCode: "O",
        isSpecialty: level === "4",
      }),
      formularyEntry: entry({ level }),
      pharmacy: level === "4" ? SPECIALTY_PHARMACY : undefined,
      quantityDispensed: 30,
      daysSupply: 30,
      dawCode,
    }),
  );
}

describe("DAW-1 brand selection penalty is Level 3 only", () => {
  it("still applies the differential on Level 3 DAW-1", () => {
    const daw0 = brandFill("3", "0");
    const daw1 = brandFill("3", "1");

    expect(daw0.responseStatus).toBe("P");
    expect(daw1.responseStatus).toBe("P");
    expect(daw0.brandSelectionPenaltyCents).toBe(0);
    expect(daw1.brandSelectionPenaltyCents).toBeGreaterThan(0);
    expect(daw1.patientPayCents).toBeGreaterThan(daw0.patientPayCents);
  });

  it("does not add the differential on Level 2 preferred brands", () => {
    const daw0 = brandFill("2", "0");
    const daw1 = brandFill("2", "1");

    expect(daw0.responseStatus).toBe("P");
    expect(daw1.responseStatus).toBe("P");
    // Level 2: 20% with $50 max; both fills clear the cap.
    expect(daw0.patientPayCents).toBe(5000);
    expect(daw1.brandSelectionPenaltyCents).toBe(0);
    expect(daw1.patientPayCents).toBe(daw0.patientPayCents);
  });

  it("does not add the differential on Level 1 brands", () => {
    const daw0 = brandFill("1", "0");
    const daw1 = brandFill("1", "1");

    expect(daw0.responseStatus).toBe("P");
    expect(daw1.responseStatus).toBe("P");
    expect(daw0.patientPayCents).toBe(500);
    expect(daw1.brandSelectionPenaltyCents).toBe(0);
    expect(daw1.patientPayCents).toBe(500);
  });

  it("does not add the differential on Level 4 specialty brands", () => {
    const daw0 = brandFill("4", "0");
    const daw1 = brandFill("4", "1");

    expect(daw0.responseStatus).toBe("P");
    expect(daw1.responseStatus).toBe("P");
    expect(daw0.patientPayCents).toBe(5000);
    expect(daw1.brandSelectionPenaltyCents).toBe(0);
    expect(daw1.patientPayCents).toBe(5000);
  });
});
