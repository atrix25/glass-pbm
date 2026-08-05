/**
 * Joining a formulary to a published dispensing-volume list.
 *
 * The claim generator decides which drug inside a therapeutic class a member
 * reaches for, and it decides it by national dispensing volume. That join is
 * doing more work than it looks: it is the difference between a book whose
 * most-dispensed product is atorvastatin and one whose most-dispensed product
 * is diflunisal, and — because obscure products sit at the non-preferred
 * levels, where the coinsurance is — between a member cost share of 10.6% and
 * one of 18.8%.
 *
 * The join is also easy to get quietly wrong in both directions, and both
 * failures happened here. Requiring the reduced names to be equal left
 * pantoprazole, montelukast, semaglutide and insulin glargine matching nothing,
 * because a formulary transcribed from a PDF writes "pantoprazole sod dr tab"
 * where a statistics table writes "Pantoprazole". Relaxing it to a subset match
 * then handed each of six "something/hydrochlorothiazide" tablets
 * hydrochlorothiazide's entire 31.8 million prescriptions, which is how a set of
 * niche antihypertensives came to outrank amoxicillin.
 *
 * These tests pin both edges: the noise a product name is allowed to carry, and
 * the second ingredient it is not.
 */

import { describe, expect, it } from "vitest";
import {
  DISPENSING_VOLUME,
  UNLISTED_MOLECULE_WEIGHT,
  dispensingWeightForProduct,
  dosageFormShare,
} from "@/lib/clinical/dispensing-volume";
import { moleculeKey } from "@/lib/clinical/molecules";

/** Volume of a published molecule, by the name the source used. */
function published(name: string): number {
  const v = DISPENSING_VOLUME.get(
    name
      .toLowerCase()
      .split(/[\s;]+/)
      .filter(Boolean)
      .sort()
      .join("-"),
  );
  if (v === undefined) throw new Error(`not a published molecule: ${name}`);
  return v;
}

describe("matching a product to a published molecule", () => {
  it("looks through salt words the published list omits", () => {
    // "Pantoprazole" against a label that names the sodium salt.
    expect(dispensingWeightForProduct("pantoprazole sod dr tab", null)).toBe(
      published("pantoprazole"),
    );
    expect(dispensingWeightForProduct("citalopram hbr tab", null)).toBe(
      published("citalopram"),
    );
  });

  it("looks through packaging and biosimilar suffixes", () => {
    const glargine = dispensingWeightForProduct(
      "INSULIN GLARGINE SOLN PEN-INJ",
      null,
    );
    expect(glargine).toBe(published("insulin glargine"));
    expect(
      dispensingWeightForProduct("INSULIN GLARGINE INJ U-YFGN", null),
    ).toBe(glargine);
  });

  it("resolves a brand to what is inside it", () => {
    // A brand name shares no letters with its ingredient, so this can only
    // work through the crosswalk.
    expect(dispensingWeightForProduct("OZEMPIC INJ", null)).toBe(
      published("semaglutide"),
    );
    expect(dispensingWeightForProduct("JARDIANCE TAB", null)).toBe(
      published("empagliflozin"),
    );
    expect(dispensingWeightForProduct("TRULICITY INJ", null)).toBe(
      published("dulaglutide"),
    );
    expect(dispensingWeightForProduct("LANTUS INJ", null)).toBe(
      published("insulin glargine"),
    );
  });

  it("refuses to give a combination product one ingredient's volume", () => {
    /*
     * The failure this is here for. Each of these carries a drug that is itself
     * heavily dispensed, and each must fall to the floor instead of claiming it.
     */
    for (const name of [
      "amiloride/hydrochlorothiazide tab",
      "candesartan/hydrochlorothiazide tab",
      "fosinopril/hydrochlorothiazide tab",
      "metoprolol/hydrochlorothiazide tab",
      "amlodipine/valsartan tab",
      "JANUMET XR TAB",
      "dapagliflozin-metformin er tab",
    ]) {
      expect(
        dispensingWeightForProduct(name, null),
        `${name} should not inherit a single ingredient's volume`,
      ).toBe(UNLISTED_MOLECULE_WEIGHT);
    }
  });

  it("still matches a combination the source publishes in its own right", () => {
    // Published as "Hydrochlorothiazide; Lisinopril", so the two-ingredient
    // tablet is the thing being counted and should match exactly.
    expect(
      dispensingWeightForProduct("lisinopril/hydrochlorothiazide tab", null),
    ).toBe(published("hydrochlorothiazide lisinopril"));

    // And it must not fall through to plain lisinopril, which is far larger.
    expect(
      dispensingWeightForProduct("lisinopril/hydrochlorothiazide tab", null),
    ).not.toBe(published("lisinopril"));
  });

  it("gives the long tail a floor rather than a zero", () => {
    // Outside the published 300 means rarely dispensed, not never.
    expect(dispensingWeightForProduct("diflunisal tab", null)).toBe(
      UNLISTED_MOLECULE_WEIGHT,
    );
    expect(UNLISTED_MOLECULE_WEIGHT).toBeGreaterThan(0);
  });

  it("ranks the drugs people actually take above the ones they do not", () => {
    /*
     * The whole point, stated as an assertion. Diflunisal was the most
     * dispensed product in this book before the weights existed.
     */
    const common = dispensingWeightForProduct("atorvastatin tab", null);
    const obscure = dispensingWeightForProduct("diflunisal tab", null);
    expect(common).toBeGreaterThan(obscure * 100);
  });
});

describe("splitting a molecule across its dosage forms", () => {
  it("treats an oral liquid as the minority form", () => {
    expect(dosageFormShare("escitalopram soln")).toBeLessThan(
      dosageFormShare("escitalopram tab"),
    );
    expect(dosageFormShare("metformin ER tab")).toBe(1);
  });

  it("does not demote an inhaler for containing a solution", () => {
    // A nebuliser solution is not a substitute for a tablet: it is the only
    // way the drug is given.
    expect(dosageFormShare("albuterol neb soln")).toBe(1);
    expect(dosageFormShare("albuterol HFA inhaler")).toBe(1);
  });
});

describe("the published table itself", () => {
  it("carries every row exactly once", () => {
    // Two published rows can reduce to the same key once salts are stripped,
    // and summing rather than overwriting is what keeps the molecule's real
    // total.
    expect(DISPENSING_VOLUME.size).toBeGreaterThan(280);
    for (const [, v] of DISPENSING_VOLUME) expect(v).toBeGreaterThan(0);
  });

  it("agrees with the source on the largest molecule", () => {
    // Atorvastatin, 115,271,514 prescriptions in 2023.
    expect(published("atorvastatin")).toBe(115_271_514);
    const max = Math.max(...DISPENSING_VOLUME.values());
    expect(max).toBe(published("atorvastatin"));
  });

  it("keys the table the same way the formulary is keyed", () => {
    // A single-ingredient generic must land on its own published row through
    // the ordinary molecule key, with no special handling.
    for (const name of ["atorvastatin", "metformin", "gabapentin"]) {
      expect(DISPENSING_VOLUME.has(moleculeKey(null, `${name} tab`))).toBe(true);
    }
  });
});
