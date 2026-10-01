/**
 * Contract reconciliation, as of the simulation clock.
 *
 * Like the sponsor dashboard, these read the daily rollup rather than the
 * claim table: the guarantee cut is stored per day as a "guarantee" dimension
 * keyed by channel and brand class, so a report that would otherwise scan a
 * million and a half claims sums a few thousand cells instead. Cutting at the
 * clock also keeps the reconciliation honest, because reporting a full plan
 * year of guarantee performance in March would be reporting on claims that
 * have not been filled yet.
 */

import { prisma } from "@/lib/db";
import { computeBrandRebateFloor } from "@/lib/contracts/rebate-floor";
import { EXHIBIT_C_RATES, WISCONSIN_CONTRACT } from "@/lib/contracts/wisconsin";
import { PLAN_YEAR_START, type SimulationClock } from "@/lib/clock";

interface Row {
  channel: string;
  brandGeneric: string;
  claims: number;
  billed: number;
  awp: number;
  fees: number;
  nadac: number;
  rebate: number;
}

function window(clock: SimulationClock) {
  return { gte: PLAN_YEAR_START, lte: clock.today };
}

/** The stored guarantee cells, split back into channel and brand class. */
async function guaranteeCells(clock: SimulationClock): Promise<Row[]> {
  const cells = await prisma.bookDayDimension.groupBy({
    by: ["key"],
    where: { dimension: "guarantee", date: window(clock) },
    _sum: {
      claims: true,
      ingredientCostCents: true,
      awpCents: true,
      dispensingFeeCents: true,
      nadacCents: true,
      rebateCents: true,
    },
  });

  return cells.map((c) => {
    const [channel, brandGeneric] = c.key.split("::");
    return {
      channel,
      brandGeneric,
      claims: c._sum.claims ?? 0,
      billed: c._sum.ingredientCostCents ?? 0,
      awp: c._sum.awpCents ?? 0,
      fees: c._sum.dispensingFeeCents ?? 0,
      nadac: c._sum.nadacCents ?? 0,
      rebate: c._sum.rebateCents ?? 0,
    };
  });
}

/**
 * Reconcile realised pricing against the Exhibit C guarantees.
 *
 * A guarantee is an aggregate promise: across all of a channel's brand claims,
 * the effective discount off AWP must average at least the guaranteed rate.
 * That is why this sums first and divides once, rather than averaging the
 * per-claim discounts, which would weight a $4 generic the same as a $9,000
 * specialty fill and produce a number that reconciles to nothing.
 */
export async function getGuaranteeReconciliation(clock: SimulationClock) {
  const rows = await guaranteeCells(clock);

  const commercial = EXHIBIT_C_RATES.filter(
    (r) => r.lineOfBusiness === "Commercial",
  );

  /*
   * Reconcile against the scope the contract actually promises. Exhibit C's
   * specialty row is drugClass "All" and its own footnote says the specialty
   * guarantee is aggregate across brand and generic. Measuring a specialty
   * generic against the 18.35% specialty rate reports a 65-point beat and
   * roughly $700,000 of savings that the contract never promised and the plan
   * never earned. Grouping by the guarantee rather than by the claim keeps
   * every row answerable to a clause.
   */
  const buckets = new Map<
    string,
    {
      channel: string;
      scope: string;
      rate: (typeof commercial)[number] | null;
      claims: number;
      billed: number;
      awp: number;
      fees: number;
      nadac: number;
      rebate: number;
    }
  >();

  for (const r of rows) {
    const rate =
      commercial.find(
        (x) => x.channel === r.channel && x.drugClass === r.brandGeneric,
      ) ??
      commercial.find((x) => x.channel === r.channel && x.drugClass === "All") ??
      null;

    const scope = rate?.drugClass === "All" ? "All" : r.brandGeneric;
    const key = `${r.channel}::${scope}`;
    const b = buckets.get(key) ?? {
      channel: r.channel,
      scope,
      rate,
      claims: 0,
      billed: 0,
      awp: 0,
      fees: 0,
      nadac: 0,
      rebate: 0,
    };
    b.claims += Number(r.claims);
    b.billed += Number(r.billed);
    b.awp += Number(r.awp);
    b.fees += Number(r.fees);
    b.nadac += Number(r.nadac);
    b.rebate += Number(r.rebate);
    buckets.set(key, b);
  }

  return [...buckets.values()]
    .map((b) => {
      const actualDiscountBps =
        b.awp > 0 ? Math.round((1 - b.billed / b.awp) * 10000) : 0;
      const guaranteedBps = b.rate?.awpDiscountBps ?? null;
      const discountVarianceBps =
        guaranteedBps == null ? null : actualDiscountBps - guaranteedBps;
      const valueAtGuaranteeCents =
        guaranteedBps == null
          ? null
          : Math.round(b.awp * (1 - guaranteedBps / 10000));

      return {
        channel: b.channel,
        // "All" is the contract's own word for an aggregate guarantee.
        scope: b.scope,
        claims: b.claims,
        billedCents: b.billed,
        awpCents: b.awp,
        feesCents: b.fees,
        nadacCents: b.nadac,
        rebateCents: b.rebate,
        guaranteedBps,
        actualDiscountBps,
        discountVarianceBps,
        guaranteedFeeCents: b.rate?.dispensingFeeCents ?? null,
        actualFeeCents: b.claims > 0 ? Math.round(b.fees / b.claims) : 0,
        dollarVarianceCents:
          valueAtGuaranteeCents == null ? null : valueAtGuaranteeCents - b.billed,
        // A guarantee only binds once the category has enough volume.
        belowMinimumVolume: b.claims < WISCONSIN_CONTRACT.minClaimsPerCategory,
        met: discountVarianceBps == null ? null : discountVarianceBps >= 0,
      };
    })
    .sort(
      (a, b) =>
        a.channel.localeCompare(b.channel) || a.scope.localeCompare(b.scope),
    );
}

export async function getRebateWaterfall(clock: SimulationClock) {
  const [agg, members, cells] = await Promise.all([
    prisma.bookDay.aggregate({
      where: { date: window(clock) },
      _sum: { estimatedRebateCents: true, brandClaims: true },
    }),
    prisma.member.count(),
    guaranteeCells(clock),
  ]);

  const brandClaims = agg._sum.brandClaims ?? 0;
  const grossRebateCents = agg._sum.estimatedRebateCents ?? 0;
  /*
   * Member months have to track the clock too. Charging a full twelve months
   * of rebate administration against a partial year of rebates would show the
   * plan underwater on a contract it is actually ahead on.
   */
  const memberMonths = Math.round(members * 12 * clock.yearElapsed);
  const rebateAdminFeeCents =
    memberMonths * WISCONSIN_CONTRACT.rebateAdminFeePmpmCents;
  const netToPlanCents = grossRebateCents - rebateAdminFeeCents;

  // Exhibit C sets a distinct floor per channel. Sum brand volume from the
  // guarantee cut (channel × brand class) rather than all-book brandClaims ×
  // the retail rate alone — specialty at $750 must not be floored at $100.
  const floor = computeBrandRebateFloor(
    cells
      .filter((c) => c.brandGeneric === "Brand")
      .map((c) => ({ channel: c.channel, claims: c.claims })),
  );
  const minGuaranteeCents = floor.minGuaranteeCents;
  const minPerBrandClaimCents = floor.blendedFloorPerClaimCents;

  return {
    grossRebateCents,
    rebateAdminFeeCents,
    netToPlanCents,
    brandClaims,
    memberMonths,
    minGuaranteeCents,
    minPerBrandClaimCents,
    guaranteeMet: grossRebateCents >= minGuaranteeCents,
    perBrandClaimCents:
      brandClaims > 0 ? Math.round(grossRebateCents / brandClaims) : 0,
  };
}

/**
 * What the same claims would have cost under a traditional spread contract.
 *
 * The comparison is not a guess about a competitor. It applies a published
 * schedule from another state's PBM contract to this plan's own utilisation,
 * so the difference is a difference in contract terms and nothing else.
 */
export async function getSpreadComparison(clock: SimulationClock) {
  // The guarantee cells already carry ingredient cost and AWP; collapsing the
  // channel out of them is the same book cut one level coarser.
  const byBrandGeneric = new Map<
    string,
    { claims: number; billed: number; awp: number }
  >();
  for (const cell of await guaranteeCells(clock)) {
    const cur = byBrandGeneric.get(cell.brandGeneric) ?? {
      claims: 0,
      billed: 0,
      awp: 0,
    };
    cur.claims += cell.claims;
    cur.billed += cell.billed;
    cur.awp += cell.awp;
    byBrandGeneric.set(cell.brandGeneric, cur);
  }

  // Michigan's OptumRx Schedule B, the closest published spread schedule.
  const SPREAD_BPS: Record<string, number> = { Brand: 1650, Generic: 7700 };

  let passThroughCents = 0;
  let spreadCents = 0;
  const byClass = [...byBrandGeneric.entries()].map(([brandGeneric, r]) => {
    const billed = Number(r.billed);
    const awp = Number(r.awp);
    const bps = SPREAD_BPS[brandGeneric] ?? 0;
    const underSpread = Math.round(awp * (1 - bps / 10000));
    passThroughCents += billed;
    spreadCents += underSpread;
    return {
      brandGeneric,
      claims: Number(r.claims),
      passThroughCents: billed,
      spreadCents: underSpread,
      deltaCents: underSpread - billed,
      spreadDiscountBps: bps,
    };
  });

  return {
    byClass,
    passThroughCents,
    spreadCents,
    deltaCents: spreadCents - passThroughCents,
  };
}

/**
 * How much of the plan's cost is anchored to a number nobody can verify.
 *
 * AWP is proprietary and unpublished. Any plan priced off it is exposed to
 * whoever sets it, so the honest thing to report is not a savings figure but
 * the size of the exposure and how it moves.
 */
export async function getAwpSensitivity(clock: SimulationClock) {
  const rows = await prisma.bookDayDimension.groupBy({
    by: ["key"],
    where: { dimension: "basis", date: window(clock) },
    _sum: { billedCents: true },
  });

  const total = rows.reduce((s, r) => s + (r._sum.billedCents ?? 0), 0);
  // NCPDP basis of reimbursement 3 is AWP.
  const awpPriced = rows
    .filter((r) => r.key === "3")
    .reduce((s, r) => s + (r._sum.billedCents ?? 0), 0);

  /*
   * The comparison arm matters more than the level. Under this contract only
   * the AWP-priced share moves with the file, because the MAC ceiling and the
   * pharmacy's cash price cap the rest. Under a spread schedule every claim is
   * priced off AWP, so the whole book moves. That difference in slope is the
   * actual argument for pass-through, and it survives being wrong about where
   * AWP sits today.
   */
  const spread = await getSpreadComparison(clock);

  const shifts = [-10, -5, 0, 5, 10, 15].map((pct) => ({
    shiftPercent: pct,
    label: `${pct > 0 ? "+" : ""}${pct}%`,
    passThroughCents: Math.round(total + awpPriced * (pct / 100)),
    traditionalCents: Math.round(spread.spreadCents * (1 + pct / 100)),
    deltaCents: Math.round(awpPriced * (pct / 100)),
  }));

  return {
    totalCents: total,
    awpPricedCents: awpPriced,
    awpShare: total > 0 ? awpPriced / total : 0,
    verifiableCents: total - awpPriced,
    shifts,
  };
}
