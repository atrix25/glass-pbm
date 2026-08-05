/**
 * The weekend and holiday emergency supply.
 *
 * The rule exists for the case where the plan's own utilisation management is
 * the only thing standing between a member and a medicine they have a valid
 * prescription for. So the tests worth writing are the ones about who bears the
 * cost of that: the member pays nothing, and because they pay nothing, nothing
 * lands on either out-of-pocket limit. It would be easy to implement this as a
 * waiver of the authorization alone and quietly charge the copay, which is the
 * version that looks correct in a claim count and is wrong at the counter.
 */

import { describe, expect, it } from "vitest";
import { adjudicate } from "@/lib/engine/adjudicate";
import {
  closureOn,
  emergencySupplyEligibility,
  federalHoliday,
  isBusinessDay,
  nextBusinessDay,
} from "@/lib/pa/emergency-supply";
import { drug, entry, makeContext } from "./fixtures";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

const SATURDAY = day("2026-03-14");
const SUNDAY = day("2026-03-15");
const MONDAY = day("2026-03-16");

describe("the closure calendar", () => {
  it("treats both weekend days as days a prescriber cannot be reached", () => {
    expect(closureOn(SATURDAY)?.reason).toBe("saturday");
    expect(closureOn(SUNDAY)?.reason).toBe("sunday");
    expect(closureOn(MONDAY)).toBeNull();
    expect(isBusinessDay(MONDAY)).toBe(true);
  });

  it("computes the moving federal holidays rather than tabulating them", () => {
    // Third Monday of January, last Monday of May, fourth Thursday of November.
    expect(federalHoliday(day("2026-01-19"))?.name).toContain("Martin Luther King");
    expect(federalHoliday(day("2026-05-25"))?.name).toBe("Memorial Day");
    expect(federalHoliday(day("2026-11-26"))?.name).toBe("Thanksgiving Day");
    expect(federalHoliday(day("2026-06-19"))?.name).toContain("Juneteenth");
  });

  it("follows the observed day, because that is when the office is shut", () => {
    // Independence Day 2026 falls on a Saturday, so it is observed on the Friday
    // and the Friday is the day an authorization cannot be moved.
    expect(federalHoliday(day("2026-07-04"))?.name).toBe("Independence Day");
    const observedFriday = federalHoliday(day("2026-07-03"));
    expect(observedFriday?.reason).toBe("observed-holiday");
    expect(observedFriday?.name).toContain("observed");
    expect(isBusinessDay(day("2026-07-03"))).toBe(false);
  });

  it("does not invent a holiday on an ordinary working day", () => {
    expect(federalHoliday(day("2026-03-16"))).toBeNull();
    expect(federalHoliday(day("2026-08-12"))).toBeNull();
  });

  it("skips the whole closure when saying when the request can be worked", () => {
    // Friday 3 July is the observed holiday and 4 and 5 July are the weekend,
    // so a Thursday fill is not workable until the Monday.
    expect(nextBusinessDay(day("2026-07-02")).toISOString().slice(0, 10)).toBe(
      "2026-07-06",
    );
    expect(nextBusinessDay(SATURDAY).toISOString().slice(0, 10)).toBe("2026-03-16");
  });
});

describe("the pharmacy has to ask for an emergency supply", () => {
  it("does not grant one that was never requested", () => {
    // Inferring it would reprice historical claims that were never submitted
    // this way, and dispensing an emergency supply is a pharmacist's decision.
    const decision = emergencySupplyEligibility({
      dateOfService: SATURDAY,
      daysSupply: 5,
    });
    expect(decision.requested).toBe(false);
    expect(decision.eligible).toBe(false);
    expect(decision.detail).toContain("418-DK");
  });

  it("grants one signalled with NCPDP level of service 3 on a closure day", () => {
    const decision = emergencySupplyEligibility({
      dateOfService: SATURDAY,
      daysSupply: 5,
      levelOfService: "3",
    });
    expect(decision.eligible).toBe(true);
    expect(decision.workableOn?.toISOString().slice(0, 10)).toBe("2026-03-16");
  });

  it("refuses one on a business day, when the prescriber can be reached", () => {
    const decision = emergencySupplyEligibility({
      dateOfService: MONDAY,
      daysSupply: 5,
      levelOfService: "3",
    });
    expect(decision.eligible).toBe(false);
    expect(decision.detail).toContain("business day");
  });

  it("holds the five-day ceiling", () => {
    expect(
      emergencySupplyEligibility({
        dateOfService: SATURDAY,
        daysSupply: 6,
        levelOfService: "3",
      }).eligible,
    ).toBe(false);
    expect(
      emergencySupplyEligibility({
        dateOfService: SATURDAY,
        daysSupply: 5,
        levelOfService: "3",
      }).eligible,
    ).toBe(true);
  });
});

describe("an emergency supply at the point of sale", () => {
  // A Level 2 brand at retail, so the only edit in the way is the
  // authorization. A Level 4 specialty drug would reject on the channel
  // restriction first and never reach the rule under test.
  const paDrug = drug({ name: "OZEMPIC INJ", isBrandLabel: true, nadacPerUnit: 90 });
  const paEntry = entry({ level: "2", specialCode: "PA-QL", requiresPA: true });

  const claim = (over: Parameters<typeof makeContext>[0]) =>
    adjudicate(makeContext(over));

  it("still refuses the fill when no emergency is signalled", () => {
    const result = claim({
      drug: paDrug,
      formularyEntry: paEntry,
      dateOfService: SATURDAY,
      daysSupply: 5,
      quantityDispensed: 2,
    });
    expect(result.responseStatus).toBe("R");
    expect(result.rejectCodes).toContain("75");
  });

  it("pays the fill when the pharmacy signals an emergency on a Saturday", () => {
    const result = claim({
      drug: paDrug,
      formularyEntry: paEntry,
      dateOfService: SATURDAY,
      daysSupply: 5,
      quantityDispensed: 2,
      levelOfService: "3",
    });
    expect(result.responseStatus).toBe("P");
    expect(result.patientPayCents).toBe(0);
  });

  it("charges the member nothing, not merely a reduced cost share", () => {
    // The failure mode this guards against is waiving the authorization and
    // billing the ordinary cost share anyway, which looks correct in a claim
    // count and is wrong at the counter. The control is the same fill with an
    // authorization on file, which does carry Level 2 coinsurance.
    const shared = {
      drug: paDrug,
      formularyEntry: paEntry,
      dateOfService: SUNDAY,
      daysSupply: 3,
      quantityDispensed: 1,
    } as const;

    const authorised = claim({ ...shared, priorAuthNumber: "PA-CONTROL" });
    expect(authorised.responseStatus).toBe("P");
    expect(authorised.patientPayCents).toBeGreaterThan(0);

    const emergency = claim({ ...shared, levelOfService: "3" });
    expect(emergency.responseStatus).toBe("P");
    expect(emergency.patientPayCents).toBe(0);
    expect(emergency.planPaidCents).toBeGreaterThan(0);
  });

  it("accumulates nothing toward either out-of-pocket limit", () => {
    // There is no member payment, so there is nothing to accumulate. Getting
    // this wrong would credit the member for money they never spent.
    const result = claim({
      drug: paDrug,
      formularyEntry: paEntry,
      dateOfService: SUNDAY,
      daysSupply: 3,
      quantityDispensed: 1,
      levelOfService: "3",
    });
    expect(result.costShare?.accumulatorDeltas).toEqual([]);
    expect(result.copayCoinsuranceCents).toBe(0);
    expect(result.appliedToDeductibleCents).toBe(0);
  });

  it("cites the published process and says when the request can be worked", () => {
    const result = claim({
      drug: paDrug,
      formularyEntry: paEntry,
      dateOfService: SATURDAY,
      daysSupply: 5,
      quantityDispensed: 2,
      levelOfService: "3",
    });
    const step = result.trace.find((s) => s.ruleId === "um.emergency-supply");
    expect(step).toBeDefined();
    expect(step!.fired).toBe(true);
    expect(step!.sourceDocumentId).toBe("navitus-pa-process");
    expect(JSON.stringify(step!.output)).toContain("2026-03-16");
  });

  it("explains itself in the trace even when it declines", () => {
    const result = claim({
      drug: paDrug,
      formularyEntry: paEntry,
      dateOfService: MONDAY,
      daysSupply: 5,
      quantityDispensed: 2,
      levelOfService: "3",
    });
    expect(result.responseStatus).toBe("R");
    const step = result.trace.find((s) => s.ruleId === "um.emergency-supply");
    expect(step?.fired).toBe(false);
    expect(step?.detail).toContain("business day");
  });

  it("leaves a drug that needs no authorization alone", () => {
    // The rule waives an authorization requirement. It is not a general
    // discount, so an ordinary generic on a Saturday still charges its copay.
    const result = claim({
      drug: drug({ name: "atorvastatin tab", nadacPerUnit: 0.2 }),
      formularyEntry: entry({ level: "1" }),
      dateOfService: SATURDAY,
      daysSupply: 5,
      levelOfService: "3",
    });
    expect(result.responseStatus).toBe("P");
    expect(result.patientPayCents).toBeGreaterThan(0);
  });
});
