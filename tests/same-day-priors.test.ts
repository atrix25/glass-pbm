/**
 * Same-day prior fills must count for quantity limits and early refill.
 *
 * Replay already pushes earlier same-DOS paid fills into `priorFills` (ordered
 * by claim). Adjudication then re-filtered with `dateOfService < dos`, which
 * drops every prior that shares the calendar day. The second fill of the day
 * therefore never saw the first: QL budgets reset and refill-too-soon never
 * fired — the plan paid a duplicate / over-limit dispense the book already had.
 *
 * POS history still needs same-day rows supplied (open #15); this locks the
 * engine once those rows are present, which they already are on the replay path.
 */

import { describe, expect, it } from "vitest";
import { adjudicate } from "@/lib/engine/adjudicate";
import { evaluateQuantityLimit } from "@/lib/engine/quantity-limit";
import { drug, entry, makeContext } from "./fixtures";

const DOS = new Date("2026-06-15T00:00:00Z");

describe("same-day prior fills in adjudication", () => {
  const qlDrug = drug({
    name: "SUMATRIPTAN",
    nadacPerUnit: 2.5,
    packageSize: 1,
    unitOfMeasure: "EA",
  });

  it("rejects 76 when an earlier same-day fill already used the QL budget", () => {
    // periodDays (30) > daysSupply (15) so the limit is a trailing budget, not a
    // per-fill rate. Two 9-unit fills on the same morning must consume 18 of 9.
    const out = adjudicate(
      makeContext({
        drug: qlDrug,
        formularyEntry: entry({
          hasQuantityLimit: true,
          qlQuantity: 9,
          qlDays: 30,
          qlUnit: "EA",
          qlBasis: "dispensing-unit",
          specialCode: "QL",
        }),
        quantityDispensed: 9,
        daysSupply: 15,
        dateOfService: DOS,
        priorFills: [
          {
            dateOfService: DOS,
            daysSupply: 15,
            quantityDispensed: 9,
            drugId: qlDrug.id,
            therapeuticClass: qlDrug.therapeuticClass,
          },
        ],
      }),
    );
    expect(out.responseStatus).toBe("R");
    expect(out.rejectCodes).toContain("76");
  });

  it("rejects 79 when an earlier same-day fill has not yet been used", () => {
    const d = drug({ nadacPerUnit: 2, isBrandLabel: false });
    const out = adjudicate(
      makeContext({
        drug: d,
        formularyEntry: entry({ level: "1" }),
        daysSupply: 30,
        quantityDispensed: 30,
        dateOfService: DOS,
        priorFills: [
          {
            dateOfService: DOS,
            daysSupply: 30,
            quantityDispensed: 30,
            drugId: d.id,
            therapeuticClass: d.therapeuticClass,
          },
        ],
      }),
    );
    expect(out.responseStatus).toBe("R");
    expect(out.rejectCodes).toContain("79");
  });
});

describe("same-day prior fills in quantity-limit cumulative windows", () => {
  it("counts an earlier same-day fill against a trailing budget", () => {
    const verdict = evaluateQuantityLimit({
      limit: {
        quantity: 9,
        unit: "EA",
        basis: "dispensing-unit",
        periodDays: 30,
        rawText: "QL= 9 EA/30 days",
      },
      quantityDispensed: 9,
      daysSupply: 15,
      dateOfService: DOS,
      packageSize: 1,
      unitOfMeasure: "EA",
      packageContainers: null,
      priorFills: [
        { dateOfService: DOS, quantityDispensed: 9, daysSupply: 15 },
      ],
      planYearStart: new Date("2026-01-01T00:00:00Z"),
    });
    expect(verdict.enforceable).toBe(true);
    if (verdict.enforceable) {
      expect(verdict.withinLimit).toBe(false);
      expect(verdict.used).toBe(18);
    }
  });
});
