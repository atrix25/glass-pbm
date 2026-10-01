import { describe, expect, it } from "vitest";
import {
  ExperienceTally,
  firstRejectCode,
  type FillOutcome,
} from "@/lib/nps/tally";

const fill = (over: Partial<FillOutcome> = {}): FillOutcome => ({
  responseStatus: "R",
  transactionCode: "B1",
  patientPayCents: 0,
  appliedToDeductibleCents: 0,
  brandSelectionPenaltyCents: 0,
  channel: "Retail",
  rejectCode: null,
  ...over,
});

describe("ExperienceTally", () => {
  it("seeds the experience with fixed signals", () => {
    const tally = new ExperienceTally("member-1", {
      paDenied: 1,
      paSlow: 2,
      paOnTime: 3,
      majorDurAlerts: 4,
      retroClawback: true,
    });

    expect(tally.exp).toMatchObject({
      memberId: "member-1",
      paDenied: 1,
      paSlow: 2,
      paOnTime: 3,
      majorDurAlerts: 4,
      retroClawback: true,
    });
  });

  it("counts a reversal and returns before paid-fill accumulation", () => {
    const tally = new ExperienceTally("member-1");
    tally.add(
      fill({
        responseStatus: "P",
        transactionCode: "B2",
        patientPayCents: 99,
      }),
    );

    expect(tally.exp.totalClaims).toBe(1);
    expect(tally.exp.reversals).toBe(1);
    expect(tally.exp.paidClaims).toBe(0);
    expect(tally.exp.oopCents).toBe(0);
  });

  it("accumulates paid claims, penalties, deductible, and extended supply", () => {
    const tally = new ExperienceTally("member-1");
    tally.add(
      fill({
        responseStatus: "P",
        patientPayCents: 1250,
        appliedToDeductibleCents: 500,
        brandSelectionPenaltyCents: 25,
        channel: "Mail",
      }),
    );
    tally.add(
      fill({
        responseStatus: "P",
        patientPayCents: 900,
        channel: "Retail90",
      }),
    );

    expect(tally.exp).toMatchObject({
      totalClaims: 2,
      paidClaims: 2,
      oopCents: 2150,
      worstFillCents: 1250,
      deductibleClaims: 1,
      brandPenaltyClaims: 1,
      extendedSupplyClaims: 2,
    });
  });

  it.each([
    ["75", "rejectsPaRequired"],
    ["608", "rejectsStepTherapy"],
    ["76", "rejectsQuantity"],
    ["79", "rejectsRefillTooSoon"],
    ["69", "rejectsTerminated"],
    ["40", "rejectsOutOfNetwork"],
  ] as const)("maps reject code %s", (code, field) => {
    const tally = new ExperienceTally("member-1");
    tally.add(fill({ rejectCode: code }));

    expect(tally.exp[field]).toBe(1);
  });

  it("ignores an unmapped reject code", () => {
    const tally = new ExperienceTally("member-1");
    tally.add(fill({ rejectCode: "999" }));

    expect(tally.exp.totalClaims).toBe(1);
    expect(tally.exp.rejectsPaRequired).toBe(0);
    expect(tally.exp.rejectsOutOfNetwork).toBe(0);
  });
});

describe("firstRejectCode", () => {
  it("returns the first code, null for an empty array, and null for malformed JSON", () => {
    expect(firstRejectCode('["75","76"]')).toBe("75");
    expect(firstRejectCode("[]")).toBeNull();
    expect(firstRejectCode("{not-json")).toBeNull();
  });
});
