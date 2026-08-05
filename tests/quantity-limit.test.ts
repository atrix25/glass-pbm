/**
 * Quantity limits, and the units they are written in.
 *
 * Two failures are being guarded against here, and they pull in opposite
 * directions. A limit that cannot fire is the Vascepa finding: Wisconsin's
 * auditor found Navitus paying Vascepa above its own four-capsules-a-day limit
 * because the edit was configured and inert. A limit that fires on a bad unit
 * conversion is the mirror image, and worse for the member: the plan writes
 * "12 tubes per year", the claim arrives billed for 60 grams, and an engine that
 * treats those as the same scale refuses a fill the member is nowhere near the
 * limit of — citing a real rule, with a real number, wrongly.
 *
 * So the tests come in pairs: the limits that should fire do, the comparisons
 * that cannot be made honestly are refused and reported, and no member is
 * denied on arithmetic between two different units.
 */

import { describe, expect, it } from "vitest";
import { adjudicate } from "@/lib/engine/adjudicate";
import {
  basisForUnit,
  evaluateQuantityLimit,
  periodInDays,
  resolvePackage,
  unitKind,
  type QuantityLimit,
} from "@/lib/engine/quantity-limit";
import { drug, entry, makeContext } from "./fixtures";

const PLAN_YEAR_START = new Date("2026-01-01T00:00:00Z");

function limit(over: Partial<QuantityLimit> = {}): QuantityLimit {
  return {
    quantity: 4,
    unit: "caps",
    basis: "dispensing-unit",
    periodDays: 1,
    rawText: "QL= 4 caps/day",
    ...over,
  };
}

function evaluate(
  l: Partial<QuantityLimit>,
  over: {
    quantityDispensed?: number;
    daysSupply?: number;
    packageSize?: number;
    unitOfMeasure?: string;
    packageContainers?: Record<string, number> | null;
    priorFills?: { dateOfService: Date; quantityDispensed: number; daysSupply: number }[];
    dateOfService?: Date;
  } = {},
) {
  return evaluateQuantityLimit({
    limit: limit(l),
    quantityDispensed: over.quantityDispensed ?? 120,
    daysSupply: over.daysSupply ?? 30,
    dateOfService: over.dateOfService ?? new Date("2026-06-15T00:00:00Z"),
    packageSize: over.packageSize ?? 1,
    unitOfMeasure: over.unitOfMeasure ?? "EA",
    packageContainers: over.packageContainers ?? null,
    priorFills: over.priorFills ?? [],
    planYearStart: PLAN_YEAR_START,
  });
}

describe("the unit a limit is written in", () => {
  it("tells a package apart from a billable unit", () => {
    expect(unitKind("tubes")).toBe("package");
    expect(unitKind("kit")).toBe("package");
    expect(unitKind("vials")).toBe("package");
    expect(unitKind("caps")).toBe("count");
    expect(unitKind("tabs")).toBe("count");
    expect(unitKind("gm")).toBe("gram");
    expect(unitKind("mL")).toBe("milliliter");
  });

  it("tells a limit on days of therapy apart from a limit on quantity", () => {
    // "Limited to 180 days/plan year" for nicotine gum counts days, not pieces.
    // Read as a quantity it would refuse the first fill of the year.
    expect(basisForUnit("days")).toBe("days-supply");
    expect(basisForUnit("fills")).toBe("fill-count");
    expect(basisForUnit("caps")).toBe("dispensing-unit");
    expect(basisForUnit("tubes")).toBe("package");
  });

  it("refuses to classify a noun it has not been taught", () => {
    // The honest answer for an unrecognised unit is "I do not know", which the
    // parse coverage report then prints by name. Guessing gives a limit that
    // enforces something nobody wrote down.
    expect(unitKind("widgets")).toBeNull();
    expect(basisForUnit("widgets")).toBeNull();
    expect(basisForUnit(null)).toBeNull();
  });

  it("reads a period, and knows a per-fill limit has none", () => {
    expect(periodInDays("28", "days")).toBe(28);
    expect(periodInDays(undefined, "day")).toBe(1);
    expect(periodInDays("26", "weeks")).toBe(182);
    expect(periodInDays(undefined, "year")).toBe(365);
    expect(periodInDays(undefined, "plan year")).toBe(365);
    // A per-fill limit is not a rate, so it gets no period rather than a
    // stand-in of thirty days that would silently turn it into one.
    expect(periodInDays(undefined, "fill")).toBeNull();
  });
});

describe("a rate limit against a single fill", () => {
  it("allows the fill its own days supply worth", () => {
    // Four a day across thirty days is a hundred and twenty.
    const v = evaluate({ quantity: 4, periodDays: 1 }, { quantityDispensed: 120 });
    expect(v.enforceable).toBe(true);
    if (!v.enforceable) return;
    expect(v.withinLimit).toBe(true);
    expect(v.allowed).toBe(120);
  });

  it("refuses the fill that exceeds it", () => {
    // This is the Vascepa shape: four capsules a day is the published limit,
    // and a hundred and eighty capsules for thirty days is six a day.
    const v = evaluate({ quantity: 4, periodDays: 1 }, { quantityDispensed: 180 });
    expect(v.enforceable).toBe(true);
    if (!v.enforceable) return;
    expect(v.withinLimit).toBe(false);
    expect(v.used).toBe(180);
    expect(v.allowed).toBe(120);
  });

  it("holds a per-fill limit against the fill and not against a rate", () => {
    const v = evaluate(
      { quantity: 9, unit: "tabs", periodDays: null, rawText: "QL= 9 tabs/fill" },
      { quantityDispensed: 9, daysSupply: 30 },
    );
    expect(v.enforceable).toBe(true);
    if (!v.enforceable) return;
    expect(v.withinLimit).toBe(true);
    expect(v.allowed).toBe(9);
    expect(v.window).toContain("per fill");
  });
});

describe("a limit spent over a period longer than the fill", () => {
  const annual = {
    quantity: 12,
    unit: "gm",
    basis: "dispensing-unit" as const,
    periodDays: 365,
    rawText: "QL= 12 gm/year",
  };

  it("does not prorate an annual budget down onto one fill", () => {
    /*
     * The bug this replaces divided twelve by three hundred and sixty-five and
     * compared the result to the fill's daily rate, which caps a single fill at
     * a thirtieth of a gram and refuses everything. An annual limit is a budget:
     * the member may spend all of it in January.
     */
    const v = evaluate(annual, {
      quantityDispensed: 12,
      daysSupply: 30,
      unitOfMeasure: "GM",
    });
    expect(v.enforceable).toBe(true);
    if (!v.enforceable) return;
    expect(v.withinLimit).toBe(true);
    expect(v.allowed).toBe(12);
  });

  it("counts what the member has already used inside the period", () => {
    const v = evaluate(annual, {
      quantityDispensed: 4,
      daysSupply: 30,
      unitOfMeasure: "GM",
      priorFills: [
        { dateOfService: new Date("2026-02-01T00:00:00Z"), quantityDispensed: 5, daysSupply: 30 },
        { dateOfService: new Date("2026-04-01T00:00:00Z"), quantityDispensed: 4, daysSupply: 30 },
      ],
    });
    expect(v.enforceable).toBe(true);
    if (!v.enforceable) return;
    // Nine already spent plus four asked for is thirteen against twelve.
    expect(v.used).toBe(13);
    expect(v.withinLimit).toBe(false);
    expect(v.window).toContain("plan year to date");
  });

  it("does not count fills from before the plan year", () => {
    const v = evaluate(annual, {
      quantityDispensed: 12,
      unitOfMeasure: "GM",
      priorFills: [
        {
          dateOfService: new Date("2025-11-01T00:00:00Z"),
          quantityDispensed: 12,
          daysSupply: 30,
        },
      ],
    });
    expect(v.enforceable).toBe(true);
    if (!v.enforceable) return;
    expect(v.used).toBe(12);
    expect(v.withinLimit).toBe(true);
  });

  it("uses a rolling window for a period shorter than a year", () => {
    const monthly = {
      quantity: 2,
      unit: "inj",
      basis: "dispensing-unit" as const,
      periodDays: 28,
      rawText: "QL= 2 inj/28 days",
    };
    const v = evaluate(monthly, {
      quantityDispensed: 1,
      daysSupply: 14,
      priorFills: [
        // Inside the trailing 28 days.
        { dateOfService: new Date("2026-06-01T00:00:00Z"), quantityDispensed: 2, daysSupply: 14 },
        // Outside it, and so not counted.
        { dateOfService: new Date("2026-01-01T00:00:00Z"), quantityDispensed: 2, daysSupply: 14 },
      ],
    });
    expect(v.enforceable).toBe(true);
    if (!v.enforceable) return;
    expect(v.used).toBe(3);
    expect(v.withinLimit).toBe(false);
    expect(v.window).toContain("trailing 28 days");
  });
});

describe("a limit on days of therapy", () => {
  const smokingCessation = {
    quantity: 180,
    unit: "days",
    basis: "days-supply" as const,
    periodDays: 365,
    rawText: "Limited to 180 days/plan year",
  };

  it("counts days and not pieces of gum", () => {
    /*
     * Read as a quantity this would compare a hundred and eighty against the
     * two hundred and ten pieces in a thirty day fill and refuse it. Read
     * correctly it is six months of therapy, and the first fill spends thirty
     * days of that.
     */
    const v = evaluate(smokingCessation, {
      quantityDispensed: 210,
      daysSupply: 30,
    });
    expect(v.enforceable).toBe(true);
    if (!v.enforceable) return;
    expect(v.withinLimit).toBe(true);
    expect(v.used).toBe(30);
    expect(v.allowed).toBe(180);
    expect(v.comparedIn).toBe("days supply");
  });

  it("stops the member who has had their six months", () => {
    const priorFills = Array.from({ length: 6 }, (_, i) => ({
      dateOfService: new Date(Date.UTC(2026, i, 1)),
      quantityDispensed: 210,
      daysSupply: 30,
    }));
    const v = evaluate(smokingCessation, {
      quantityDispensed: 210,
      daysSupply: 30,
      dateOfService: new Date("2026-12-01T00:00:00Z"),
      priorFills,
    });
    expect(v.enforceable).toBe(true);
    if (!v.enforceable) return;
    // Six fills of thirty days is a hundred and eighty; the seventh is over.
    expect(v.used).toBe(210);
    expect(v.withinLimit).toBe(false);
  });
});

describe("a limit on the number of fills", () => {
  it("counts fills inside the period", () => {
    const fills = {
      quantity: 2,
      unit: "fills",
      basis: "fill-count" as const,
      periodDays: 365,
      rawText: "Limited to 2 fills/plan year",
    };
    const v = evaluate(fills, {
      priorFills: [
        { dateOfService: new Date("2026-02-01T00:00:00Z"), quantityDispensed: 1, daysSupply: 30 },
        { dateOfService: new Date("2026-03-01T00:00:00Z"), quantityDispensed: 1, daysSupply: 30 },
      ],
    });
    expect(v.enforceable).toBe(true);
    if (!v.enforceable) return;
    expect(v.used).toBe(3);
    expect(v.withinLimit).toBe(false);
  });
});

describe("a limit written in packages", () => {
  it("knows how many billable units are in a package when the NDC says", () => {
    const r = resolvePackage("tubes", {
      containers: { TUBE: 60, CARTON: 60 },
      packageSize: 60,
      unitOfMeasure: "GM",
    });
    expect(r?.unitsPerPackage).toBe(60);
  });

  it("does not invent a package size that was never recorded", () => {
    // Nobody dispenses a one-gram tube of cream, so a package size of one on a
    // drug billed by the gram is an unpopulated column, not a fact.
    expect(
      resolvePackage("tubes", {
        containers: null,
        packageSize: 1,
        unitOfMeasure: "GM",
      }),
    ).toBeNull();
  });

  it("converts the limit into billable units and then enforces it", () => {
    const v = evaluate(
      {
        quantity: 12,
        unit: "tubes",
        basis: "package",
        periodDays: 365,
        rawText: "QL= 12 tubes/year",
      },
      {
        quantityDispensed: 60,
        daysSupply: 30,
        packageSize: 60,
        unitOfMeasure: "GM",
        packageContainers: { TUBE: 60, CARTON: 60 },
      },
    );
    expect(v.enforceable).toBe(true);
    if (!v.enforceable) return;
    // Twelve tubes of sixty grams is seven hundred and twenty grams a year, and
    // one tube spends sixty of them.
    expect(v.allowed).toBe(720);
    expect(v.used).toBe(60);
    expect(v.withinLimit).toBe(true);
  });

  it("refuses to enforce a package limit with no package size, and says why", () => {
    /*
     * This is the Opzelura case, and the reason it matters. The limit is twelve
     * tubes a year, the claim is billed for sixty grams, and the drug record
     * carries no grams-per-tube. Comparing sixty against twelve refuses two
     * hundred and nine fills across thirty-nine members and $272,906 of plan
     * spend on a conversion nobody supplied. The limit goes unenforced and is
     * reported as a gap, which is the only defensible answer: an operator can
     * populate a package size, and no member is denied in the meantime.
     */
    const v = evaluate(
      {
        quantity: 12,
        unit: "tubes",
        basis: "package",
        periodDays: 365,
        rawText: "QL= 12 tubes/year",
      },
      { quantityDispensed: 60, packageSize: 1, unitOfMeasure: "GM" },
    );
    expect(v.enforceable).toBe(false);
    if (v.enforceable) return;
    expect(v.reason).toContain("tubes");
    expect(v.reason).toContain("GM");
    expect(v.reason).toContain("gap");
  });
});

describe("two units that count different things are never compared", () => {
  it("refuses a limit in capsules against a drug billed by the gram", () => {
    const v = evaluate(
      { quantity: 30, unit: "caps", periodDays: 30, rawText: "QL= 30 caps/30 days" },
      { quantityDispensed: 60, unitOfMeasure: "GM" },
    );
    expect(v.enforceable).toBe(false);
    if (v.enforceable) return;
    expect(v.reason).toContain("count different things");
  });

  it("still enforces a limit in grams against a drug billed by the gram", () => {
    const v = evaluate(
      { quantity: 100, unit: "gm", periodDays: 30, rawText: "QL= 100 gm/30 days" },
      { quantityDispensed: 60, unitOfMeasure: "GM" },
    );
    expect(v.enforceable).toBe(true);
    if (!v.enforceable) return;
    expect(v.withinLimit).toBe(true);
  });

  it("has nothing to enforce when the clause yielded no number", () => {
    const v = evaluate({ quantity: 0 });
    expect(v.enforceable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End to end, through the adjudication pipeline
// ---------------------------------------------------------------------------

describe("the limit at the point of sale", () => {
  it("refuses the fill that exceeds a limit it can measure", () => {
    const result = adjudicate(
      makeContext({
        drug: drug({ name: "icosapent ethyl cap", nadacPerUnit: 1.2 }),
        formularyEntry: entry({
          level: "2",
          specialCode: "QL",
          hasQuantityLimit: true,
          qlQuantity: 4,
          qlDays: 1,
          qlUnit: "caps",
          qlBasis: "dispensing-unit",
          qlRawText: "QL= 4 caps/day",
        }),
        quantityDispensed: 180,
        daysSupply: 30,
      }),
    );
    expect(result.responseStatus).toBe("R");
    expect(result.rejectCodes).toContain("76");

    const step = result.trace.find((s) => s.ruleId === "um.quantity-limit");
    expect(step?.fired).toBe(true);
    expect(step?.citation).toContain("QL= 4 caps/day");
  });

  it("pays the fill that is inside it", () => {
    const result = adjudicate(
      makeContext({
        drug: drug({ name: "icosapent ethyl cap", nadacPerUnit: 1.2 }),
        formularyEntry: entry({
          level: "2",
          specialCode: "QL",
          hasQuantityLimit: true,
          qlQuantity: 4,
          qlDays: 1,
          qlUnit: "caps",
          qlBasis: "dispensing-unit",
          qlRawText: "QL= 4 caps/day",
        }),
        quantityDispensed: 120,
        daysSupply: 30,
      }),
    );
    expect(result.responseStatus).toBe("P");
  });

  it("pays the fill whose limit cannot be measured, and records the gap", () => {
    const result = adjudicate(
      makeContext({
        drug: drug({
          name: "OPZELURA CREAM",
          isBrandLabel: true,
          nadacPerUnit: 28,
          packageSize: 1,
          unitOfMeasure: "GM",
        }),
        formularyEntry: entry({
          level: "3",
          specialCode: "PA-QL",
          hasQuantityLimit: true,
          qlQuantity: 12,
          qlDays: 365,
          qlUnit: "tubes",
          qlBasis: "package",
          qlRawText: "QL= 12 tubes/year",
        }),
        quantityDispensed: 60,
        daysSupply: 30,
      }),
    );
    expect(result.responseStatus).toBe("P");

    const gap = result.trace.find(
      (s) => s.ruleId === "um.quantity-limit.not-enforceable",
    );
    expect(gap).toBeDefined();
    expect(gap!.fired).toBe(false);
    expect(gap!.detail).toContain("guess");
    // The limit is still cited, so the gap is discoverable from the claim
    // rather than only from a report nobody runs.
    expect(gap!.citation).toContain("QL= 12 tubes/year");
    expect(result.trace.some((s) => s.ruleId === "um.quantity-limit")).toBe(false);
  });

  it("counts the member's earlier fills when the limit is annual", () => {
    const opzelura = drug({
      name: "OPZELURA CREAM",
      isBrandLabel: true,
      nadacPerUnit: 28,
      packageSize: 60,
      unitOfMeasure: "GM",
      packageContainers: { TUBE: 60, CARTON: 60 },
    });
    const entryWithLimit = entry({
      level: "3",
      specialCode: "PA-QL",
      hasQuantityLimit: true,
      qlQuantity: 12,
      qlDays: 365,
      qlUnit: "tubes",
      qlBasis: "package",
      qlRawText: "QL= 12 tubes/year",
    });

    // Twelve tubes at sixty grams is seven hundred and twenty grams. Twelve
    // monthly fills of sixty grams spends exactly that, so the thirteenth is
    // over the limit and the twelfth is not.
    const priorFills = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        dateOfService: new Date(Date.UTC(2026, i, 1)),
        daysSupply: 30,
        quantityDispensed: 60,
        drugId: opzelura.id,
        therapeuticClass: opzelura.therapeuticClass,
      }));

    const twelfth = adjudicate(
      makeContext({
        drug: opzelura,
        formularyEntry: entryWithLimit,
        quantityDispensed: 60,
        daysSupply: 30,
        dateOfService: new Date("2026-12-01T00:00:00Z"),
        priorFills: priorFills(11),
      }),
    );
    expect(twelfth.responseStatus).toBe("P");

    const thirteenth = adjudicate(
      makeContext({
        drug: opzelura,
        formularyEntry: entryWithLimit,
        quantityDispensed: 60,
        daysSupply: 30,
        // Far enough after the twelfth fill that the refill-too-soon edit is
        // satisfied, so the limit is the only thing left to refuse it.
        dateOfService: new Date("2026-12-29T00:00:00Z"),
        priorFills: priorFills(12),
      }),
    );
    expect(thirteenth.responseStatus).toBe("R");
    expect(thirteenth.rejectCodes).toContain("76");
  });
});
