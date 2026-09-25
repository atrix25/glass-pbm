/**
 * Step and quantity exceptions must actually waive the edits they exist for.
 *
 * Approving a StepException and still rejecting 608 — or approving a
 * QuantityException and still rejecting 76 — is the member paying cash for a
 * fill the plan already said it would cover. The opposite bug (exceptions
 * unlocking specialty PA) is tracked separately; these tests only lock the
 * waiver that product copy promises.
 */

import { describe, expect, it } from "vitest";
import { adjudicate } from "@/lib/engine/adjudicate";
import { drug, entry, makeContext } from "./fixtures";

describe("step-therapy exception", () => {
  const stDrug = drug({
    name: "ESOMEPRAZOLE MAGNESIUM",
    therapeuticClass: "Proton pump inhibitors",
    nadacPerUnit: 0.85,
  });

  it("rejects 608 when step is required and no alternative or exception is on file", () => {
    const out = adjudicate(
      makeContext({
        drug: stDrug,
        formularyEntry: entry({ requiresStep: true, specialCode: "ST" }),
        approvedPAs: [],
        priorFills: [],
      }),
    );
    expect(out.responseStatus).toBe("R");
    expect(out.rejectCodes).toContain("608");
  });

  it("pays when an approved StepException covers the fill, even with no prior alternative", () => {
    const out = adjudicate(
      makeContext({
        drug: stDrug,
        formularyEntry: entry({ requiresStep: true, specialCode: "ST" }),
        approvedPAs: [
          {
            drugId: stDrug.id,
            effectiveDate: new Date("2026-01-01T00:00:00Z"),
            terminationDate: new Date("2026-12-31T00:00:00Z"),
            requestType: "StepException",
          },
        ],
        priorFills: [],
      }),
    );
    expect(out.responseStatus).toBe("P");
    expect(out.rejectCodes ?? []).not.toContain("608");
  });

  it("still pays when claims history shows a prior alternative in class", () => {
    const preferred = drug({
      name: "OMEPRAZOLE",
      therapeuticClass: "Proton pump inhibitors",
      nadacPerUnit: 0.2,
      isBrandLabel: false,
    });
    const out = adjudicate(
      makeContext({
        drug: stDrug,
        formularyEntry: entry({ requiresStep: true, specialCode: "ST" }),
        priorFills: [
          {
            dateOfService: new Date("2026-02-01T00:00:00Z"),
            daysSupply: 30,
            quantityDispensed: 30,
            drugId: preferred.id,
            therapeuticClass: preferred.therapeuticClass,
          },
        ],
      }),
    );
    expect(out.responseStatus).toBe("P");
  });
});

describe("quantity-limit exception", () => {
  const qlDrug = drug({
    name: "SUMATRIPTAN",
    nadacPerUnit: 2.5,
    packageSize: 1,
    unitOfMeasure: "EA",
  });

  it("rejects 76 when the fill exceeds the published limit", () => {
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
        quantityDispensed: 18,
        daysSupply: 30,
      }),
    );
    expect(out.responseStatus).toBe("R");
    expect(out.rejectCodes).toContain("76");
  });

  it("pays when an approved QuantityException covers the over-limit fill", () => {
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
        quantityDispensed: 18,
        daysSupply: 30,
        approvedPAs: [
          {
            drugId: qlDrug.id,
            effectiveDate: new Date("2026-01-01T00:00:00Z"),
            terminationDate: new Date("2026-12-31T00:00:00Z"),
            requestType: "QuantityException",
          },
        ],
      }),
    );
    expect(out.responseStatus).toBe("P");
    expect(out.rejectCodes ?? []).not.toContain("76");
  });
});
