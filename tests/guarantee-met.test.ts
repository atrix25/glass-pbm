/**
 * Exhibit C pricing guarantees only bind at 1,000 claims per category.
 * Categories under that floor must not be scored as missed, or Reports and
 * the data agent will say "short of guarantee" when the promise does not
 * bind yet (early clock / Mail / Specialty).
 */

import { describe, expect, it } from "vitest";
import { pricingGuaranteeMet } from "@/lib/contracts/guarantee-met";
import { WISCONSIN_CONTRACT } from "@/lib/contracts/wisconsin";

const MIN = WISCONSIN_CONTRACT.minClaimsPerCategory;

describe("pricingGuaranteeMet", () => {
  it("returns null when there is no guaranteed rate to compare", () => {
    expect(pricingGuaranteeMet(null, 5_000, MIN)).toBeNull();
  });

  it("does not score below-minimum volume as missed on a negative variance", () => {
    // Concrete trigger: Specialty with 400 claims and −120 bps vs guarantee.
    // Old reports.ts set met: false; consumers counted that as "short".
    expect(pricingGuaranteeMet(-120, 400, MIN)).toBeNull();
  });

  it("does not score below-minimum volume as met on a positive variance", () => {
    expect(pricingGuaranteeMet(80, 999, MIN)).toBeNull();
  });

  it("scores at-or-above the floor from discount variance alone", () => {
    expect(pricingGuaranteeMet(-1, MIN, MIN)).toBe(false);
    expect(pricingGuaranteeMet(0, MIN, MIN)).toBe(true);
    expect(pricingGuaranteeMet(25, MIN + 1, MIN)).toBe(true);
  });
});
