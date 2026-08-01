import { prisma } from "@/lib/db";
import { EXHIBIT_C_RATES, WISCONSIN_CONTRACT } from "@/lib/contracts/wisconsin";

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

/**
 * Reconcile realised pricing against the Exhibit C guarantees.
 *
 * A guarantee is an aggregate promise: across all of a channel's brand claims,
 * the effective discount off AWP must average at least the guaranteed rate.
 * That is why this sums first and divides once, rather than averaging the
 * per-claim discounts, which would weight a $4 generic the same as a $9,000
 * specialty fill and produce a number that reconciles to nothing.
 */
export async function getGuaranteeReconciliation() {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      channel,
      brandGenericClass AS brandGeneric,
      COUNT(*)                       AS claims,
      SUM(billedIngredientCostCents) AS billed,
      SUM(awpTotalCents)             AS awp,
      SUM(billedDispensingFeeCents)   AS fees,
      SUM(nadacTotalCents)           AS nadac,
      SUM(estimatedRebateCents)      AS rebate
    FROM Claim
    WHERE responseStatus = 'P' AND awpTotalCents > 0
    GROUP BY channel, brandGenericClass
  `;

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

export async function getRebateWaterfall() {
  const [agg, members] = await Promise.all([
    prisma.claim.aggregate({
      where: { responseStatus: "P" },
      _sum: { estimatedRebateCents: true },
      _count: { _all: true },
    }),
    prisma.member.count(),
  ]);

  const brandClaims = await prisma.claim.count({
    where: { responseStatus: "P", brandGenericClass: "Brand" },
  });

  const grossRebateCents = agg._sum.estimatedRebateCents ?? 0;
  const memberMonths = members * 12;
  const rebateAdminFeeCents =
    memberMonths * WISCONSIN_CONTRACT.rebateAdminFeePmpmCents;
  const netToPlanCents = grossRebateCents - rebateAdminFeeCents;

  // Exhibit C guarantees a floor per brand claim, separately from whatever the
  // manufacturer contracts actually yield. The plan gets the larger of the two.
  const minPerBrandClaimCents =
    EXHIBIT_C_RATES.find(
      (r) =>
        r.lineOfBusiness === "Commercial" &&
        r.channel === "Retail" &&
        r.drugClass === "Brand",
    )?.minRebatePerBrandClaimCents ?? 0;
  const minGuaranteeCents = brandClaims * minPerBrandClaimCents;

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
export async function getSpreadComparison() {
  const rows = await prisma.$queryRaw<
    { brandGeneric: string; claims: number; billed: number; awp: number }[]
  >`
    SELECT brandGenericClass AS brandGeneric,
           COUNT(*)                     AS claims,
           SUM(billedIngredientCostCents) AS billed,
           SUM(awpTotalCents)           AS awp
    FROM Claim
    WHERE responseStatus = 'P' AND awpTotalCents > 0
    GROUP BY brandGenericClass
  `;

  // Michigan's OptumRx Schedule B, the closest published spread schedule.
  const SPREAD_BPS: Record<string, number> = { Brand: 1650, Generic: 7700 };

  let passThroughCents = 0;
  let spreadCents = 0;
  const byClass = rows.map((r) => {
    const billed = Number(r.billed);
    const awp = Number(r.awp);
    const bps = SPREAD_BPS[r.brandGeneric] ?? 0;
    const underSpread = Math.round(awp * (1 - bps / 10000));
    passThroughCents += billed;
    spreadCents += underSpread;
    return {
      brandGeneric: r.brandGeneric,
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
export async function getAwpSensitivity() {
  const rows = await prisma.$queryRaw<
    { basis: string; claims: number; billed: number }[]
  >`
    SELECT basisOfReimbursement AS basis,
           COUNT(*)                AS claims,
           SUM(totalBilledCents)   AS billed
    FROM Claim
    WHERE responseStatus = 'P'
    GROUP BY basisOfReimbursement
  `;

  const total = rows.reduce((s, r) => s + Number(r.billed), 0);
  const awpPriced = rows
    .filter((r) => r.basis === "3")
    .reduce((s, r) => s + Number(r.billed), 0);

  /*
   * The comparison arm matters more than the level. Under this contract only
   * the AWP-priced share moves with the file, because the MAC ceiling and the
   * pharmacy's cash price cap the rest. Under a spread schedule every claim is
   * priced off AWP, so the whole book moves. That difference in slope is the
   * actual argument for pass-through, and it survives being wrong about where
   * AWP sits today.
   */
  const spread = await getSpreadComparison();

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
