/**
 * Golden claims.
 *
 * Each case states the expected outcome as arithmetic a reader can do on
 * paper from the published contract, and only then asks the engine. The point
 * is not that the engine agrees with itself; it is that the engine agrees with
 * Exhibit C and the Certificate of Coverage.
 *
 * If one of these fails, either the engine is wrong or the contract was read
 * wrong. Both are worth stopping for.
 */

import { describe, expect, it } from "vitest";
import { adjudicate } from "@/lib/engine/adjudicate";
import { DEFAULT_ASSUMPTIONS, deriveUnitPrices } from "@/lib/engine/benchmark";
import {
  makeContext,
  RETAIL_PHARMACY,
  SPECIALTY_PHARMACY,
  OON_PHARMACY,
  MAIL_PHARMACY,
  drug,
  entry,
} from "./fixtures";

describe("cost share, straight from the Certificate of Coverage", () => {
  it("charges a $5 copay on a Level 1 generic", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 0.42, isBrandLabel: false }),
        formularyEntry: entry({ level: "1" }),
        quantityDispensed: 30,
        daysSupply: 30,
      }),
    );

    expect(out.responseStatus).toBe("P");
    expect(out.patientPayCents).toBe(500);
    expect(out.planPaidCents).toBe(out.totalBilledCents - 500);
  });

  it("never charges more than the drug costs, even at a $5 copay", () => {
    // A 30-day fill of a drug costing under $5 in total. The copay cannot
    // exceed the price of the thing being bought.
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 0.01, isBrandLabel: false }),
        formularyEntry: entry({ level: "1" }),
        quantityDispensed: 30,
        daysSupply: 30,
      }),
    );

    expect(out.responseStatus).toBe("P");
    expect(out.patientPayCents).toBeLessThanOrEqual(out.totalBilledCents);
    expect(out.patientPayCents).toBeLessThan(500);
  });

  it("charges 20% on Level 2 and stops at the $50 per-fill maximum", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 12, isBrandLabel: true }),
        formularyEntry: entry({ level: "2" }),
        quantityDispensed: 30,
        daysSupply: 30,
      }),
    );

    expect(out.responseStatus).toBe("P");
    // 20% of a $360-plus fill exceeds the cap, so the cap binds exactly.
    expect(out.totalBilledCents * 0.2).toBeGreaterThan(5000);
    expect(out.patientPayCents).toBe(5000);
  });

  it("charges 20% on Level 2 when the fill is small enough not to reach the cap", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 1.1, isBrandLabel: true }),
        formularyEntry: entry({ level: "2" }),
        quantityDispensed: 30,
        daysSupply: 30,
      }),
    );

    expect(out.responseStatus).toBe("P");
    const twentyPercent = Math.round(out.totalBilledCents * 0.2);
    expect(out.patientPayCents).toBeLessThan(5000);
    // Allow a cent of rounding at the boundary.
    expect(Math.abs(out.patientPayCents - twentyPercent)).toBeLessThanOrEqual(1);
  });

  it("charges 40% on Level 3 and stops at the $150 per-fill maximum", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 40, isBrandLabel: true }),
        formularyEntry: entry({ level: "3" }),
        quantityDispensed: 30,
        daysSupply: 30,
      }),
    );

    expect(out.responseStatus).toBe("P");
    expect(out.patientPayCents).toBe(15000);
  });

  it("charges nothing on a preventive drug", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 2.5, isBrandLabel: false }),
        formularyEntry: entry({ level: "$0" }),
        quantityDispensed: 30,
        daysSupply: 30,
      }),
    );

    expect(out.responseStatus).toBe("P");
    expect(out.patientPayCents).toBe(0);
    expect(out.planPaidCents).toBe(out.totalBilledCents);
  });
});

describe("the $600 prescription out-of-pocket limit", () => {
  it("counts Level 1 and Level 2 cost share toward it", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 12, isBrandLabel: true }),
        formularyEntry: entry({ level: "2" }),
        quantityDispensed: 30,
        daysSupply: 30,
      }),
    );

    const rx = out.costShare?.accumulatorDeltas.find(
      (d) => d.accumulatorType === "RxOopIndividual",
    );
    expect(rx?.amountMicros).toBeGreaterThan(0);
  });

  it("does not count Level 3 cost share toward it, only toward the federal maximum", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 40, isBrandLabel: true }),
        formularyEntry: entry({ level: "3" }),
        quantityDispensed: 30,
        daysSupply: 30,
      }),
    );

    const rx = out.costShare?.accumulatorDeltas.find(
      (d) => d.accumulatorType === "RxOopIndividual",
    );
    const federal = out.costShare?.accumulatorDeltas.find(
      (d) => d.accumulatorType === "FederalOopIndividual",
    );

    expect(rx).toBeUndefined();
    expect(federal?.amountMicros).toBeGreaterThan(0);
  });

  it("charges nothing on a Level 1 fill once the limit is already reached", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 0.42, isBrandLabel: false }),
        formularyEntry: entry({ level: "1" }),
        quantityDispensed: 30,
        daysSupply: 30,
        accumulators: {
          rxOopAccumulatedCents: 60000,
          federalOopAccumulatedCents: 60000,
          deductibleAccumulatedCents: 0,
        },
      }),
    );

    expect(out.responseStatus).toBe("P");
    expect(out.patientPayCents).toBe(0);
  });

  it("charges only the remainder on the fill that crosses the limit", () => {
    // $597 already accumulated, so at most $3 of a $5 copay can be charged.
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 0.42, isBrandLabel: false }),
        formularyEntry: entry({ level: "1" }),
        quantityDispensed: 30,
        daysSupply: 30,
        accumulators: {
          rxOopAccumulatedCents: 59700,
          federalOopAccumulatedCents: 59700,
          deductibleAccumulatedCents: 0,
        },
      }),
    );

    expect(out.responseStatus).toBe("P");
    expect(out.patientPayCents).toBe(300);
  });

  it("keeps charging on Level 3 after the limit, because it never applied", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 40, isBrandLabel: true }),
        formularyEntry: entry({ level: "3" }),
        quantityDispensed: 30,
        daysSupply: 30,
        accumulators: {
          rxOopAccumulatedCents: 60000,
          federalOopAccumulatedCents: 60000,
          deductibleAccumulatedCents: 0,
        },
      }),
    );

    expect(out.responseStatus).toBe("P");
    expect(out.patientPayCents).toBe(15000);
  });
});

describe("the lesser-of pricing logic in Exhibit C", () => {
  it("pays the lowest of the contract arms that apply", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 2, isBrandLabel: false }),
        formularyEntry: entry({ level: "1" }),
        quantityDispensed: 30,
        daysSupply: 30,
      }),
    );

    expect(out.responseStatus).toBe("P");
    const considered = out.pricing?.arms.filter((a) => a.applicable) ?? [];
    expect(considered.length).toBeGreaterThan(1);
    const lowest = Math.min(...considered.map((a) => a.ingredientCostMicros));
    expect(out.pricing?.allowedIngredientCostMicros).toBe(lowest);
  });

  it("caps at the pharmacy's own cash price when that is lower", () => {
    // A pharmacy running a discount programme prices below the contract.
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 2, isBrandLabel: false }),
        formularyEntry: entry({ level: "1" }),
        quantityDispensed: 30,
        daysSupply: 30,
        usualAndCustomaryCents: 400,
      }),
    );

    expect(out.responseStatus).toBe("P");
    expect(out.pricing?.winningArm).toBe("UANDC");
    expect(out.billedIngredientCostCents).toBeLessThanOrEqual(400);
  });

  it("prices a generic off the MAC ceiling rather than the AWP discount", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 2, isBrandLabel: false }),
        formularyEntry: entry({ level: "1" }),
        quantityDispensed: 30,
        daysSupply: 30,
        // High cash price so the U&C arm cannot win.
        usualAndCustomaryCents: 100_000,
      }),
    );

    expect(out.pricing?.winningArm).toBe("MAC");
  });

  it("derives AWP deterministically from the NDC, so a claim replays identically", () => {
    const a = deriveUnitPrices("00093505698", 2.5, false, DEFAULT_ASSUMPTIONS);
    const b = deriveUnitPrices("00093505698", 2.5, false, DEFAULT_ASSUMPTIONS);
    expect(a.awpPerUnit).toBe(b.awpPerUnit);

    const c = deriveUnitPrices("00378395293", 2.5, false, DEFAULT_ASSUMPTIONS);
    expect(c.awpPerUnit).not.toBe(a.awpPerUnit);
  });
});

describe("dispensing fees, Exhibit C", () => {
  it("pays $0.90 on a retail fill", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 2, isBrandLabel: false }),
        formularyEntry: entry({ level: "1" }),
        quantityDispensed: 30,
        daysSupply: 30,
      }),
    );
    expect(out.billedDispensingFeeCents).toBe(90);
  });

  it("pays no dispensing fee on a mail fill", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 2, isBrandLabel: false }),
        formularyEntry: entry({ level: "1" }),
        pharmacy: MAIL_PHARMACY,
        quantityDispensed: 90,
        daysSupply: 90,
      }),
    );
    expect(out.channel).toBe("Mail");
    expect(out.billedDispensingFeeCents).toBe(0);
  });

  it("classifies 84 days or more as Retail 90, per the Exhibit C footnote", () => {
    const short = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 2, isBrandLabel: false }),
        formularyEntry: entry({ level: "1" }),
        quantityDispensed: 83,
        daysSupply: 83,
      }),
    );
    const long = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 2, isBrandLabel: false }),
        formularyEntry: entry({ level: "1" }),
        quantityDispensed: 84,
        daysSupply: 84,
      }),
    );

    expect(short.channel).toBe("Retail");
    expect(long.channel).toBe("Retail90");
  });
});

describe("rejections a member would actually hit", () => {
  it("rejects an out-of-network pharmacy with code 40", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 2, isBrandLabel: false }),
        formularyEntry: entry({ level: "1" }),
        pharmacy: OON_PHARMACY,
      }),
    );
    expect(out.responseStatus).toBe("R");
    expect(out.rejectCodes).toContain("40");
  });

  it("rejects a refill before 75% of the days supply has elapsed", () => {
    const d = drug({ nadacPerUnit: 2, isBrandLabel: false });
    const out = adjudicate(
      makeContext({
        drug: d,
        formularyEntry: entry({ level: "1" }),
        daysSupply: 30,
        quantityDispensed: 30,
        dateOfService: new Date("2026-03-15T00:00:00Z"),
        priorFills: [
          {
            dateOfService: new Date("2026-03-01T00:00:00Z"),
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

  it("allows the refill once 75% has elapsed", () => {
    const d = drug({ nadacPerUnit: 2, isBrandLabel: false });
    const out = adjudicate(
      makeContext({
        drug: d,
        formularyEntry: entry({ level: "1" }),
        daysSupply: 30,
        quantityDispensed: 30,
        dateOfService: new Date("2026-03-24T00:00:00Z"),
        priorFills: [
          {
            dateOfService: new Date("2026-03-01T00:00:00Z"),
            daysSupply: 30,
            quantityDispensed: 30,
            drugId: d.id,
            therapeuticClass: d.therapeuticClass,
          },
        ],
      }),
    );
    expect(out.responseStatus).toBe("P");
  });

  it("rejects a specialty drug filled at a retail counter", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 300, isBrandLabel: true, isSpecialty: true }),
        formularyEntry: entry({ level: "4", mandatorySpecialty: true }),
        pharmacy: RETAIL_PHARMACY,
      }),
    );
    expect(out.responseStatus).toBe("R");
  });

  it("pays the same specialty drug at a designated specialty pharmacy", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 300, isBrandLabel: true, isSpecialty: true }),
        formularyEntry: entry({ level: "4", mandatorySpecialty: true }),
        pharmacy: SPECIALTY_PHARMACY,
      }),
    );
    expect(out.responseStatus).toBe("P");
    expect(out.patientPayCents).toBe(5000);
  });

  it("rejects for prior authorization when none is on file", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 300, isBrandLabel: true, isSpecialty: true }),
        formularyEntry: entry({ level: "4", requiresPA: true, mandatorySpecialty: true }),
        pharmacy: SPECIALTY_PHARMACY,
      }),
    );
    expect(out.responseStatus).toBe("R");
    expect(out.rejectCodes).toContain("75");
  });

  it("pays once an approval covering the date of service exists", () => {
    const d = drug({ nadacPerUnit: 300, isBrandLabel: true, isSpecialty: true });
    const out = adjudicate(
      makeContext({
        drug: d,
        formularyEntry: entry({ level: "4", requiresPA: true, mandatorySpecialty: true }),
        pharmacy: SPECIALTY_PHARMACY,
        dateOfService: new Date("2026-06-15T00:00:00Z"),
        approvedPAs: [
          {
            drugId: d.id,
            effectiveDate: new Date("2026-01-01T00:00:00Z"),
            terminationDate: new Date("2026-12-31T00:00:00Z"),
          },
        ],
      }),
    );
    expect(out.responseStatus).toBe("P");
  });

  it("pays the same calendar day a live Approve is recorded, even when effectiveDate is afternoon", () => {
    /*
     * /api/pa/decide used to store approvedEffectiveDate = clock.now (e.g.
     * 14:00Z). POS rebuilds date of service as UTC midnight of the date field.
     * Instant comparison rejected every same-day fill with code 75.
     */
    const d = drug({ nadacPerUnit: 300, isBrandLabel: true, isSpecialty: true });
    const out = adjudicate(
      makeContext({
        drug: d,
        formularyEntry: entry({ level: "4", requiresPA: true, mandatorySpecialty: true }),
        pharmacy: SPECIALTY_PHARMACY,
        dateOfService: new Date("2026-06-15T00:00:00Z"),
        approvedPAs: [
          {
            drugId: d.id,
            effectiveDate: new Date("2026-06-15T14:32:00Z"),
            terminationDate: new Date("2026-09-13T14:32:00Z"),
          },
        ],
      }),
    );
    expect(out.responseStatus).toBe("P");
  });

  it("rejects when the approval has expired before the date of service", () => {
    const d = drug({ nadacPerUnit: 300, isBrandLabel: true, isSpecialty: true });
    const out = adjudicate(
      makeContext({
        drug: d,
        formularyEntry: entry({ level: "4", requiresPA: true, mandatorySpecialty: true }),
        pharmacy: SPECIALTY_PHARMACY,
        dateOfService: new Date("2026-06-15T00:00:00Z"),
        approvedPAs: [
          {
            drugId: d.id,
            effectiveDate: new Date("2026-01-01T00:00:00Z"),
            terminationDate: new Date("2026-05-01T00:00:00Z"),
          },
        ],
      }),
    );
    expect(out.responseStatus).toBe("R");
    expect(out.rejectCodes).toContain("75");
  });

  it("rejects a plan exclusion outright", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 20, isBrandLabel: true }),
        formularyEntry: entry({ level: "NC", planExclusion: true, notCovered: true }),
      }),
    );
    expect(out.responseStatus).toBe("R");
  });

  it("rejects a fill over the plan's quantity limit", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 2, isBrandLabel: false }),
        formularyEntry: entry({
          level: "1",
          hasQuantityLimit: true,
          qlQuantity: 30,
          qlDays: 30,
        }),
        quantityDispensed: 60,
        daysSupply: 30,
      }),
    );
    expect(out.responseStatus).toBe("R");
    expect(out.rejectCodes).toContain("76");
  });

  it("allows a fill exactly at the quantity limit", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 2, isBrandLabel: false }),
        formularyEntry: entry({
          level: "1",
          hasQuantityLimit: true,
          qlQuantity: 30,
          qlDays: 30,
        }),
        quantityDispensed: 30,
        daysSupply: 30,
      }),
    );
    expect(out.responseStatus).toBe("P");
  });
});

describe("eligibility", () => {
  it("rejects a date of service before coverage begins", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 2, isBrandLabel: false }),
        formularyEntry: entry({ level: "1" }),
        dateOfService: new Date("2025-12-31T00:00:00Z"),
      }),
    );
    expect(out.responseStatus).toBe("R");
    expect(out.rejectCodes).toContain("67");
  });

  it("rejects a date of service after coverage terminates", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 2, isBrandLabel: false }),
        formularyEntry: entry({ level: "1" }),
        dateOfService: new Date("2026-08-01T00:00:00Z"),
        eligibility: {
          id: "elig-test",
          effectiveDate: new Date("2026-01-01T00:00:00Z"),
          terminationDate: new Date("2026-06-30T00:00:00Z"),
          benefitPlanId: "wi-iyc-2026",
        },
      }),
    );
    expect(out.responseStatus).toBe("R");
    expect(out.rejectCodes).toContain("69");
  });
});
