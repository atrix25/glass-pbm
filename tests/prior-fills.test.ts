/**
 * Book-order priors for reproduce and POS.
 *
 * Seed and empty-override replay price each paid fill against every earlier
 * fill on the same calendar day. A history cut of `dateOfService < dos` drops
 * those priors, so a second fill the same morning is priced as if the first
 * never happened — wrong patient pay near a deductible or out-of-pocket limit,
 * and a proof page that disagrees with the book.
 */

import { describe, expect, it } from "vitest";
import {
  isPriorPaidFill,
  priorPaidClaimsWhere,
} from "@/lib/engine/prior-fills";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("isPriorPaidFill", () => {
  const current = {
    dateOfService: day("2026-03-15"),
    claimNumber: "CLM000000042",
  };

  it("counts an earlier calendar day as prior", () => {
    expect(
      isPriorPaidFill(
        { dateOfService: day("2026-03-14"), claimNumber: "CLM000000099" },
        current,
      ),
    ).toBe(true);
  });

  it("counts a same-day fill with a lower claim number as prior", () => {
    expect(
      isPriorPaidFill(
        { dateOfService: day("2026-03-15"), claimNumber: "CLM000000041" },
        current,
      ),
    ).toBe(true);
  });

  it("does not count the claim itself as prior", () => {
    expect(isPriorPaidFill(current, current)).toBe(false);
  });

  it("does not count a later same-day claim number as prior", () => {
    expect(
      isPriorPaidFill(
        { dateOfService: day("2026-03-15"), claimNumber: "CLM000000043" },
        current,
      ),
    ).toBe(false);
  });

  it("treats every same-day paid fill as prior when quoting POS", () => {
    expect(
      isPriorPaidFill(
        { dateOfService: day("2026-03-15"), claimNumber: "CLM000000999" },
        { dateOfService: day("2026-03-15") },
      ),
    ).toBe(true);
  });
});

describe("priorPaidClaimsWhere", () => {
  const dos = day("2026-03-15");

  it("encodes same-day earlier claim numbers for reproduce", () => {
    expect(priorPaidClaimsWhere("m1", dos, "CLM000000042")).toEqual({
      memberId: "m1",
      responseStatus: "P",
      OR: [
        { dateOfService: { lt: dos } },
        { dateOfService: dos, claimNumber: { lt: "CLM000000042" } },
      ],
    });
  });

  it("includes the whole date of service for a POS quote", () => {
    expect(priorPaidClaimsWhere("m1", dos)).toEqual({
      memberId: "m1",
      responseStatus: "P",
      OR: [{ dateOfService: { lt: dos } }, { dateOfService: dos }],
    });
  });
});

describe("same-day accumulator handoff", () => {
  /**
   * Minimal stand-in for the rebuild loop: two Level-1 $5 pays on one day.
   * The second fill must see $5 of Rx OOP already accumulated, matching seed.
   */
  it("applies the earlier same-day fill before pricing the later one", () => {
    const fills = [
      {
        claimNumber: "CLM000000010",
        dateOfService: day("2026-03-15"),
        patientPayCents: 500,
        formularyLevel: "1",
      },
      {
        claimNumber: "CLM000000011",
        dateOfService: day("2026-03-15"),
        patientPayCents: 500,
        formularyLevel: "1",
      },
    ];
    const current = fills[1]!;
    const rxOopLevels = new Set(["1", "2"]);

    let rxOop = 0;
    for (const c of fills) {
      if (!isPriorPaidFill(c, current)) continue;
      if (rxOopLevels.has(c.formularyLevel)) rxOop += c.patientPayCents;
    }

    expect(rxOop).toBe(500);
  });
});
