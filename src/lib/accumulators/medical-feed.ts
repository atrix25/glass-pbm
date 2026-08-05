/**
 * The medical carrier's accumulator feed.
 *
 * The High Deductible Health Plan carries one $1,700 deductible across medical
 * and pharmacy. This system adjudicates pharmacy. That means the medical half
 * of the deductible is not a number it can derive — it is a number it is told,
 * on a file, by whoever pays the medical claims. Every integrated plan works
 * this way, and the file is the reason integrated deductibles are a perennial
 * source of member complaints: the pharmacy counter is quoting a balance that
 * was true whenever the last file landed.
 *
 * Leaving the feed out is not neutral. A member with a $1,700 integrated
 * deductible and no medical feed pays all $1,700 of it at the pharmacy, which
 * is both wrong and expensively wrong: it inflates the member's share of drug
 * spend by most of the deductible. The published book this population is
 * calibrated against reports a member share of 10.6%, and pharmacy-only
 * deductible collection pushes it near 19%.
 *
 * The amounts here are drawn, not invented freehand. Two published figures set
 * the shape:
 *
 *   - Two thirds (66%) of large-employer enrollees who used health care had
 *     deductible spending. The remaining third had none, and for them the
 *     pharmacy benefit really does see the whole deductible.
 *   - Of average annual cost sharing, $60 went to inpatient and $678 to
 *     outpatient services against $177 for prescription drugs. Medical is
 *     roughly four fifths of a member's cost-sharing dollars, so it consumes
 *     most of a shared deductible, and usually first.
 *
 * Both are Peterson-KFF analyses of MarketScan claims for large employer plans.
 * They describe employer coverage generally rather than this sponsor
 * specifically, which is the honest limit of the model and is stated as such
 * wherever the feed is shown.
 */

import { unitHash } from "@/lib/hash";

export const KFF_COST_SHARING_SOURCE = "kff-cost-sharing-2023";
export const KFF_DEDUCTIBLE_SOURCE = "kff-deductible-relief-day";

/**
 * Share of members with any medical deductible spending in a year.
 * Peterson-KFF, Deductible Relief Day.
 */
export const SHARE_WITH_MEDICAL_DEDUCTIBLE_SPEND = 0.66;

/**
 * Medical services, with the share of medical cost-sharing dollars each
 * accounts for and a plausible allowed amount range. Derived from the
 * inpatient/outpatient split in the KFF cost-sharing analysis: outpatient care
 * is the overwhelming majority of encounters, inpatient is rare and large.
 */
const SERVICES: Array<{
  description: string;
  weight: number;
  minCents: number;
  maxCents: number;
}> = [
  { description: "Office visit, established patient", weight: 34, minCents: 11_000, maxCents: 24_000 },
  { description: "Diagnostic laboratory panel", weight: 20, minCents: 4_500, maxCents: 16_000 },
  { description: "Diagnostic imaging, radiograph", weight: 12, minCents: 12_000, maxCents: 38_000 },
  { description: "Specialist consultation", weight: 11, minCents: 22_000, maxCents: 48_000 },
  { description: "Physical therapy visit", weight: 8, minCents: 13_000, maxCents: 26_000 },
  { description: "Advanced imaging, MRI or CT", weight: 6, minCents: 70_000, maxCents: 210_000 },
  { description: "Urgent care visit", weight: 5, minCents: 20_000, maxCents: 42_000 },
  { description: "Outpatient procedure, ambulatory surgery", weight: 3, minCents: 180_000, maxCents: 620_000 },
  { description: "Emergency department visit", weight: 1.5, minCents: 140_000, maxCents: 380_000 },
  { description: "Inpatient admission", weight: 0.5, minCents: 600_000, maxCents: 2_400_000 },
];

const TOTAL_WEIGHT = SERVICES.reduce((s, x) => s + x.weight, 0);

export interface MedicalEncounter {
  /** Day of the plan year the service was incurred, 0-364. */
  day: number;
  amountCents: number;
  description: string;
}

/**
 * The medical encounters a member incurs across a plan year.
 *
 * Deterministic in the member id: the same member always draws the same
 * encounters, in every runtime, so a claim re-adjudicated next year sees the
 * same deductible balance it saw the first time. This is the same reason the
 * NPS temperament draws are hashed rather than sampled from a shared stream.
 *
 * Only the deductible matters to pharmacy adjudication, so generation stops
 * once the encounters cover the deductible. A member with a $9,000 hospital
 * stay and a $1,700 deductible has met it; the rest is the medical plan's
 * business and appears on no pharmacy accumulator.
 */
export function medicalEncountersFor(
  memberId: string,
  deductibleCents: number,
): MedicalEncounter[] {
  if (deductibleCents <= 0) return [];

  /*
   * The third of members with no deductible spending at all. Their pharmacy
   * claims carry the full deductible, and they are why the member share of
   * drug spend stays above the all-plans average rather than collapsing.
   */
  if (unitHash(`${memberId}:medical:any`) > SHARE_WITH_MEDICAL_DEDUCTIBLE_SPEND) {
    return [];
  }

  /*
   * How much of the deductible medical care eventually eats. Drawn across the
   * full range rather than fixed, because the interesting cases are the
   * partial ones: a member who reaches the counter with $340 of a $1,700
   * deductible left pays that $340 on drugs and nothing after.
   *
   * Squaring the draw biases toward the low end, matching a spending
   * distribution where most people have a few ordinary visits and a few have
   * an admission. The result is that a majority of members with any medical
   * spending still have deductible left when they fill a prescription.
   */
  const reach = unitHash(`${memberId}:medical:reach`) ** 2;
  const targetCents = Math.round(deductibleCents * (0.15 + reach * 1.1));

  const encounters: MedicalEncounter[] = [];
  let accumulated = 0;
  for (let i = 0; i < 24 && accumulated < targetCents; i++) {
    const pick = unitHash(`${memberId}:medical:svc:${i}`) * TOTAL_WEIGHT;
    let cursor = 0;
    let service = SERVICES[SERVICES.length - 1]!;
    for (const s of SERVICES) {
      cursor += s.weight;
      if (pick <= cursor) {
        service = s;
        break;
      }
    }
    const spread = unitHash(`${memberId}:medical:amt:${i}`);
    const amountCents =
      service.minCents +
      Math.round(spread * (service.maxCents - service.minCents));

    encounters.push({
      day: Math.floor(unitHash(`${memberId}:medical:day:${i}`) * 365),
      amountCents,
      description: service.description,
    });
    accumulated += amountCents;
  }

  encounters.sort((a, b) => a.day - b.day);

  /*
   * Trim to the deductible. Anything past it is paid by the medical plan and
   * would never appear on a deductible accumulator file, and the final
   * encounter is cut rather than dropped so the balance lands exactly where
   * the medical carrier would report it.
   */
  const trimmed: MedicalEncounter[] = [];
  let running = 0;
  for (const e of encounters) {
    if (running >= deductibleCents) break;
    const amountCents = Math.min(e.amountCents, deductibleCents - running);
    trimmed.push({ ...e, amountCents });
    running += amountCents;
  }
  return trimmed;
}

/**
 * Deductible consumed by medical claims incurred strictly before a date.
 *
 * "Before" is the important word. A pharmacy claim on 3 March is priced
 * against the medical care that had happened by 3 March, not against the
 * year's total, which is the same rule the pharmacy accumulator follows and
 * the reason both are rebuilt from dated rows rather than read from a stored
 * balance.
 */
export function medicalDeductibleAsOf(
  encounters: MedicalEncounter[],
  dayOfYear: number,
): number {
  let total = 0;
  for (const e of encounters) {
    if (e.day < dayOfYear) total += e.amountCents;
  }
  return total;
}

/**
 * Days since 1 January of the date's own year.
 *
 * Encounters are numbered in days from the start of the plan year, and every
 * caller that asks for a balance has a date of service rather than an offset.
 * Keeping the conversion here means the seeder, the point-of-sale path and the
 * replay engine cannot drift apart on what "day 0" means, which would show up
 * as claims re-adjudicating to different amounts than they were paid at.
 */
export function dayOfPlanYear(dateOfService: Date): number {
  const yearStart = Date.UTC(dateOfService.getUTCFullYear(), 0, 1);
  return Math.floor((dateOfService.getTime() - yearStart) / 86_400_000);
}
