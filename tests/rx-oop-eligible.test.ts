/**
 * Prescription OOP eligibility must follow the enrolled plan, not a hardcoded
 * IYC Level 1–2 list. HDHP credits every formulary level toward its Rx limit.
 */

import { describe, expect, it } from "vitest";
import {
  buildOopCurve,
  sumRxOopCents,
} from "@/lib/queries/members";
import {
  countsTowardRxOop,
  formatRxOopEligibleLevels,
  parseRxOopEligibleLevels,
} from "@/lib/rx-oop";

describe("parseRxOopEligibleLevels", () => {
  it("defaults to IYC Levels 1 and 2", () => {
    expect(parseRxOopEligibleLevels(undefined)).toEqual(["1", "2"]);
    expect(parseRxOopEligibleLevels(null)).toEqual(["1", "2"]);
    expect(parseRxOopEligibleLevels("")).toEqual(["1", "2"]);
  });

  it("reads the HDHP list from the benefit plan column", () => {
    expect(parseRxOopEligibleLevels("[1,2,3,4]")).toEqual(["1", "2", "3", "4"]);
  });

  it("tolerates stringified numbers and whitespace in JSON", () => {
    expect(parseRxOopEligibleLevels('["1", "2"]')).toEqual(["1", "2"]);
  });
});

describe("countsTowardRxOop", () => {
  const iyc = parseRxOopEligibleLevels("[1,2]");
  const hdhp = parseRxOopEligibleLevels("[1,2,3,4]");

  it("excludes Level 3 and 4 on IYC", () => {
    expect(countsTowardRxOop("1", iyc)).toBe(true);
    expect(countsTowardRxOop("3", iyc)).toBe(false);
    expect(countsTowardRxOop("4", iyc)).toBe(false);
  });

  it("includes Level 3 and 4 on HDHP", () => {
    expect(countsTowardRxOop("3", hdhp)).toBe(true);
    expect(countsTowardRxOop("4", hdhp)).toBe(true);
  });
});

describe("sumRxOopCents / buildOopCurve against HDHP", () => {
  const fills = [
    {
      dateOfService: new Date("2026-02-01T00:00:00Z"),
      patientPayCents: 5_000,
      formularyLevel: "2",
      responseStatus: "P",
    },
    {
      dateOfService: new Date("2026-03-01T00:00:00Z"),
      patientPayCents: 15_000,
      formularyLevel: "3",
      responseStatus: "P",
    },
    {
      dateOfService: new Date("2026-04-01T00:00:00Z"),
      patientPayCents: 5_000,
      formularyLevel: "4",
      responseStatus: "P",
    },
  ];

  it("understates Rx OOP when Levels 1–2 are hardcoded against HDHP history", () => {
    // The pre-fix bug: Level 3/4 patient pay dropped from the gauge.
    const wrong = sumRxOopCents(fills, ["1", "2"]);
    expect(wrong).toBe(5_000);

    const hdhp = sumRxOopCents(fills, ["1", "2", "3", "4"]);
    expect(hdhp).toBe(25_000);
  });

  it("builds a curve that credits Level 3/4 under HDHP eligibility", () => {
    const curve = buildOopCurve(fills, ["1", "2", "3", "4"]);
    expect(curve[curve.length - 1]?.rxOopCents).toBe(25_000);

    const iycCurve = buildOopCurve(fills, ["1", "2"]);
    expect(iycCurve[iycCurve.length - 1]?.rxOopCents).toBe(5_000);
  });
});

describe("formatRxOopEligibleLevels", () => {
  it("names every credited level for gauge copy", () => {
    expect(formatRxOopEligibleLevels(["1", "2"])).toBe(
      "Level 1 and Level 2",
    );
    expect(formatRxOopEligibleLevels(["1", "2", "3", "4"])).toBe(
      "Level 1, Level 2, Level 3, and Level 4",
    );
  });
});
