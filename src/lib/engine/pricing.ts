/**
 * The lesser-of pricing engine.
 *
 * A traditional PBM runs this twice with two different rate tables: once
 * against the pharmacy contract to decide what the pharmacy is paid, and once
 * against the client contract to decide what the plan is billed. The gap is
 * the spread. A pass-through PBM runs it once and bills what it paid.
 *
 * Two configuration values do most of the work and are therefore stored as
 * explicit data rather than buried in code:
 *
 *   lesserOfArms  — which benchmarks are allowed to enter the minimum
 *   includeUandC  — whether the pharmacy's own cash price caps the claim
 *
 * Dropping usual & customary from the comparison is the classic way a plan
 * ends up paying more than the walk-in price for the same bottle.
 */

import {
  add,
  applyDiscountBps,
  min as microMin,
  type Micros,
} from "@/lib/money";
import type { ExtendedPrices } from "./benchmark";
import {
  BASIS_OF_REIMBURSEMENT,
  type PricedArm,
  type PricingArm,
  type PricingResult,
} from "./types";

export interface RateTerms {
  awpDiscountBps?: number | null;
  dispensingFeeMicros: Micros;
  lesserOfArms: PricingArm[];
  includeUandC: boolean;
  /** Applied to the MAC benchmark. A traditional PBM's client-side MAC list
   *  sits above its pharmacy-side list; this is that ratio. 1.0 for
   *  pass-through. */
  macMultiplier?: number;
}

export interface PricingInputs {
  prices: ExtendedPrices;
  usualAndCustomaryMicros: Micros;
  submittedIngredientCostMicros: Micros;
  rate: RateTerms;
}

export function priceClaim(inputs: PricingInputs): PricingResult {
  const { prices, usualAndCustomaryMicros, submittedIngredientCostMicros, rate } =
    inputs;

  const arms: PricedArm[] = [];

  for (const arm of rate.lesserOfArms) {
    switch (arm) {
      case "AWP_MINUS": {
        if (rate.awpDiscountBps == null) {
          arms.push({
            arm,
            ingredientCostMicros: 0,
            applicable: false,
            reason: "No AWP discount configured for this channel and drug class",
          });
          break;
        }
        arms.push({
          arm,
          ingredientCostMicros: applyDiscountBps(
            prices.awpMicros,
            rate.awpDiscountBps,
          ),
          applicable: true,
        });
        break;
      }
      case "MAC": {
        if (prices.macMicros === undefined) {
          arms.push({
            arm,
            ingredientCostMicros: 0,
            applicable: false,
            reason: "No MAC price on file; MAC lists cover generics only",
          });
          break;
        }
        const multiplier = rate.macMultiplier ?? 1;
        arms.push({
          arm,
          ingredientCostMicros: Math.round(prices.macMicros * multiplier),
          applicable: true,
        });
        break;
      }
      case "NADAC": {
        arms.push({
          arm,
          ingredientCostMicros: prices.nadacMicros,
          applicable: true,
        });
        break;
      }
      case "SUBMITTED": {
        arms.push({
          arm,
          ingredientCostMicros: submittedIngredientCostMicros,
          applicable: submittedIngredientCostMicros > 0,
          reason:
            submittedIngredientCostMicros > 0
              ? undefined
              : "Pharmacy did not submit an ingredient cost",
        });
        break;
      }
      case "UANDC": {
        // Usual & customary is an all-in retail price, so it is compared
        // against ingredient cost PLUS the dispensing fee, not against
        // ingredient cost alone. Handled below rather than as an arm here.
        break;
      }
    }
  }

  const applicable = arms.filter((a) => a.applicable);
  if (applicable.length === 0) {
    throw new Error("No applicable pricing arm; cannot price claim");
  }

  const lowest = applicable.reduce((lo, a) =>
    a.ingredientCostMicros < lo.ingredientCostMicros ? a : lo,
  );

  let winningArm: PricingArm = lowest.arm;
  let allowedIngredientCostMicros = lowest.ingredientCostMicros;
  let totalAllowedMicros = add(
    allowedIngredientCostMicros,
    rate.dispensingFeeMicros,
  );

  // The usual & customary test applies to the all-in total, because U&C is
  // what the pharmacy would have charged a cash customer for the whole fill.
  const uandcConsidered =
    rate.includeUandC &&
    rate.lesserOfArms.includes("UANDC") &&
    usualAndCustomaryMicros > 0;

  if (uandcConsidered && usualAndCustomaryMicros < totalAllowedMicros) {
    winningArm = "UANDC";
    totalAllowedMicros = usualAndCustomaryMicros;
    // Back the dispensing fee out of the U&C total so the components still sum.
    allowedIngredientCostMicros = Math.max(
      0,
      totalAllowedMicros - rate.dispensingFeeMicros,
    );
  }

  arms.push({
    arm: "UANDC",
    ingredientCostMicros: usualAndCustomaryMicros,
    applicable: uandcConsidered,
    reason: uandcConsidered
      ? undefined
      : rate.includeUandC
        ? "Pharmacy did not submit a usual & customary charge"
        : "Contract excludes usual & customary from the lesser-of comparison",
  });

  const dependsOnSimulatedAwp = winningArm === "AWP_MINUS";

  return {
    arms,
    winningArm,
    allowedIngredientCostMicros,
    dispensingFeeMicros:
      winningArm === "UANDC"
        ? microMin(rate.dispensingFeeMicros, totalAllowedMicros)
        : rate.dispensingFeeMicros,
    totalAllowedMicros,
    basisOfReimbursement: BASIS_OF_REIMBURSEMENT[winningArm],
    dependsOnSimulatedAwp,
  };
}

/**
 * What the claim WOULD have cost on the AWP arm, regardless of which arm won.
 *
 * This is the denominator of the effective-rate guarantee: the contract
 * promises an average discount off AWP, and performance is measured as the gap
 * between that line and what was actually paid.
 */
export function expectedIngredientCostUnderGuarantee(
  prices: ExtendedPrices,
  awpDiscountBps: number | null | undefined,
): Micros {
  if (awpDiscountBps == null) return 0;
  return applyDiscountBps(prices.awpMicros, awpDiscountBps);
}
