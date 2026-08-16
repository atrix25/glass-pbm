/**
 * Price benchmarks.
 *
 * NADAC is real. It is published weekly by CMS from a survey of pharmacy
 * invoice prices, and every claim priced against it can be checked against a
 * public file.
 *
 * AWP is not. It is proprietary to Medi-Span and First Databank, and Exhibit C
 * states plainly that "Medi-Span is Navitus' only source of drug pricing data
 * and is utilized for all claims adjudication." The plan sponsor is
 * contractually bound to a benchmark it cannot independently audit.
 *
 * Rather than hide that, this module derives a stand-in from NADAC using
 * explicit, surfaced multipliers, and marks every derived figure as simulated.
 * The multipliers are exposed in the AWP sensitivity analysis so a viewer can
 * see how much the reported guarantee performance moves when an unverifiable
 * input changes.
 *
 * Why brand and generic multipliers differ by so much: this is real market
 * structure, not an artifact. Brand pharmacies buy near WAC, so AWP sits about
 * 20% above what they pay, which is why brand discount guarantees are in the
 * high teens. Generic AWP is a largely notional list number sitting many times
 * above acquisition cost, which is why generic guarantees run 83% to 88%. A
 * single multiplier would make the contract's own rate structure incoherent.
 *
 * The generic multiplier is calibrated so that the MAC ceiling, not the AWP
 * discount, governs most retail generic claims. That is what happens in
 * practice: the AWP discount is an aggregate guarantee reconciled after the
 * fact, while the MAC list is what actually prices the individual fill.
 */

import { fromDecimal, multiplyByQuantity, type Micros } from "@/lib/money";

export interface BenchmarkAssumptions {
  /** AWP as a multiple of NADAC for brand products. */
  awpMultiplierBrand: number;
  /** AWP as a multiple of NADAC for generic products. */
  awpMultiplierGeneric: number;
  /** AWP as a multiple of NADAC for specialty generics. */
  awpMultiplierSpecialtyGeneric: number;
  /** The MAC ceiling as a multiple of NADAC, for generics only. */
  macMultiplierGeneric: number;
  /** Per-drug pseudo-random spread applied to the AWP multiplier, +/- this fraction. */
  variance: number;
}

export const DEFAULT_ASSUMPTIONS: BenchmarkAssumptions = {
  awpMultiplierBrand: 1.25,
  awpMultiplierGeneric: 8.0,
  awpMultiplierSpecialtyGeneric: 1.35,
  macMultiplierGeneric: 1.2,
  variance: 0.12,
};

/**
 * Deterministic per-NDC jitter, so the same drug always receives the same
 * AWP and a claim replays identically.
 */
function ndcJitter(ndc: string): number {
  let hash = 2166136261;
  for (let i = 0; i < ndc.length; i++) {
    hash ^= ndc.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Map to [-1, 1)
  return ((hash >>> 0) / 0xffffffff) * 2 - 1;
}

export interface UnitPrices {
  /** Real, from the CMS NADAC file. */
  nadacPerUnit: number;
  /** Simulated. */
  awpPerUnit: number;
  /** Simulated, generics only. */
  macPerUnit?: number;
  awpIsSimulated: true;
}

export function deriveUnitPrices(
  ndc: string,
  nadacPerUnit: number,
  isBrand: boolean,
  assumptions: BenchmarkAssumptions = DEFAULT_ASSUMPTIONS,
  isSpecialty = false,
): UnitPrices {
  /*
   * Specialty generics are not retail generics. Imatinib and its peers are
   * limited-distribution products whose AWP sits close to acquisition cost,
   * the way a brand does, not eight times above it. Pricing them off the
   * retail generic multiplier makes the AWP arm win at an enormous discount
   * and reports the specialty channel beating its 18.35% guarantee by 23
   * points, which is an artifact of the assumption rather than anything the
   * contract or the pharmacy did.
   */
  const base = isBrand
    ? assumptions.awpMultiplierBrand
    : isSpecialty
      ? assumptions.awpMultiplierSpecialtyGeneric
      : assumptions.awpMultiplierGeneric;
  const jitter = 1 + ndcJitter(ndc) * assumptions.variance;
  const awpPerUnit = nadacPerUnit * base * jitter;

  return {
    nadacPerUnit,
    awpPerUnit,
    // A MAC list governs multi-source retail generics. Specialty products are
    // not on one, so there is no MAC arm to apply.
    macPerUnit:
      isBrand || isSpecialty
        ? undefined
        : nadacPerUnit * assumptions.macMultiplierGeneric,
    awpIsSimulated: true,
  };
}

export interface ExtendedPrices {
  nadacMicros: Micros;
  awpMicros: Micros;
  macMicros?: Micros;
}

/** Extend per-unit prices across the dispensed quantity. */
export function extendPrices(
  unit: UnitPrices,
  quantity: number,
): ExtendedPrices {
  return {
    nadacMicros: multiplyByQuantity(fromDecimal(unit.nadacPerUnit), quantity),
    awpMicros: multiplyByQuantity(fromDecimal(unit.awpPerUnit), quantity),
    macMicros:
      unit.macPerUnit === undefined
        ? undefined
        : multiplyByQuantity(fromDecimal(unit.macPerUnit), quantity),
  };
}
