/**
 * Tools the data agent may call.
 *
 * Same contract as member-service tools: the agent never computes a dollar
 * figure. Every number comes back from a query over the claim ledger or the
 * contract reports, with citations attached.
 */

import { z } from "zod";
import type { SimulationClock } from "@/lib/clock";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { formatNumber } from "@/lib/utils";
import { getSource } from "@/lib/sources";
import {
  getBookTotals,
  getChannelMix,
  getBasisMix,
  getTopDrugs,
  getTopClasses,
  getRejectMix,
} from "@/lib/queries/sponsor";
import {
  getGuaranteeReconciliation,
  getRebateWaterfall,
  getSpreadComparison,
  getAwpSensitivity,
} from "@/lib/queries/reports";
import {
  getTrendOverview,
  getClassDrivers,
  getDrugDrivers,
} from "@/lib/queries/trends";
import {
  getSettlementOverview,
  getInvoiceOverview,
  getRebateLedger,
} from "@/lib/queries/settlement";
import {
  getScorecard,
  getIncidents,
  getRebateFloor,
} from "@/lib/queries/reconciliation";
import { listClaims, getClaimDetail } from "@/lib/queries/claims";
import {
  getHighCostDrugUtilizationManagement,
  searchFormularyUtilizationManagement,
  type UmSearchFlag,
} from "@/lib/queries/formulary-um";
import { getPriorAuthQueueStats } from "@/lib/queries/pa";
import { getMacOverview, getAppealOverview } from "@/lib/queries/mac";
import { getCurrentReading } from "@/lib/queries/nps";
import { getIntegrityOverview } from "@/lib/queries/integrity";
import { getClinicalOverview } from "@/lib/queries/clinical";
import { getFeedOverview } from "@/lib/queries/eligibility";
import type { Citation, ToolResult } from "./tools";

function cite(sourceId: string, locator?: string): Citation {
  const s = getSource(sourceId);
  return {
    sourceId: s.id,
    title: s.title,
    publisher: s.publisher,
    url: s.url,
    locator,
  };
}

const CONTRACT_CITES = [
  cite("etg0013-amd1-exhibit-c", "Exhibit C guaranteed pricing terms"),
  cite("etg0013-amd5-gpo", "Rebate administration"),
];

function bpsLabel(bps: number | null | undefined): string {
  if (bps == null) return "—";
  return `${(bps / 100).toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// Tool implementations (clock-injected via bindDataTools)
// ---------------------------------------------------------------------------

export const getBookSnapshotSchema = z.object({});

async function getBookSnapshot(
  clock: SimulationClock,
): Promise<ToolResult> {
  const [totals, channel, basis] = await Promise.all([
    getBookTotals(clock),
    getChannelMix(clock),
    getBasisMix(clock),
  ]);
  const netPlan =
    totals.planPaidCents - totals.rebateCents;
  return {
    data: {
      asOf: clock.today.toISOString().slice(0, 10),
      yearElapsed: clock.yearElapsed,
      totals,
      netPlanPaidCents: netPlan,
      channel: channel.map((c) => ({
        channel: c.channel,
        claims: c.claims,
        billedCents: c.billedCents,
        planPaidCents: c.planPaidCents,
      })),
      basis: basis.map((b) => ({
        basis: b.basis,
        claims: b.claims,
        billedCents: b.billedCents,
      })),
    },
    citations: CONTRACT_CITES,
    summary: `Book through ${clock.today.toISOString().slice(0, 10)}: ${formatNumber(totals.claimsPaid)} paid claims, plan billed ${formatCentsCompact(totals.totalBilledCents)}, estimated rebates ${formatCentsCompact(totals.rebateCents)}, spread ${formatCents(totals.spreadCents)}.`,
  };
}

export const getContractReportsSchema = z.object({
  sections: z
    .array(z.enum(["guarantees", "rebates", "spread", "awp"]))
    .optional()
    .describe("Which report sections to fetch; omit for all four"),
});

async function getContractReports(
  clock: SimulationClock,
  args: z.infer<typeof getContractReportsSchema>,
): Promise<ToolResult> {
  const want = new Set(
    args.sections ?? ["guarantees", "rebates", "spread", "awp"],
  );
  const data: Record<string, unknown> = {
    asOf: clock.today.toISOString().slice(0, 10),
  };
  const parts: string[] = [];

  if (want.has("guarantees")) {
    const guarantees = await getGuaranteeReconciliation(clock);
    data.guarantees = guarantees;
    const missed = guarantees.filter((g) => g.met === false);
    parts.push(
      missed.length === 0
        ? "All pricing guarantee categories met"
        : `${missed.length} pricing guarantee categor${missed.length === 1 ? "y" : "ies"} short`,
    );
  }
  if (want.has("rebates")) {
    const rebates = await getRebateWaterfall(clock);
    data.rebates = rebates;
    parts.push(
      `Rebates ${rebates.guaranteeMet ? "at or above" : "below"} the brand floor (${formatCentsCompact(rebates.grossRebateCents)} gross)`,
    );
  }
  if (want.has("spread")) {
    const spread = await getSpreadComparison(clock);
    data.spread = spread;
    parts.push(
      `Same utilisation under a published spread schedule would cost ${formatCentsCompact(spread.deltaCents)} more`,
    );
  }
  if (want.has("awp")) {
    const awp = await getAwpSensitivity(clock);
    data.awp = awp;
    parts.push(
      `${((awp.awpShare ?? 0) * 100).toFixed(1)}% of billed cost priced on AWP`,
    );
  }

  return {
    data,
    citations: CONTRACT_CITES,
    summary: parts.join("; ") + ".",
  };
}

export const getTrendDriversSchema = z.object({});

async function getTrendDriversTool(
  clock: SimulationClock,
): Promise<ToolResult> {
  const overview = await getTrendOverview(clock);
  if (!overview) {
    return {
      data: { available: false },
      citations: [],
      summary:
        "Not enough plan-year history yet for a two-period trend bridge (need at least 28 days).",
    };
  }
  const [classes, drugs] = await Promise.all([
    getClassDrivers(overview),
    getDrugDrivers(overview),
  ]);
  return {
    data: {
      available: true,
      current: overview.current,
      prior: overview.prior,
      netChangeCents: overview.netChangeCents,
      drivers: overview.drivers,
      topClasses: classes.slice(0, 8),
      topDrugs: drugs.slice(0, 10),
    },
    citations: CONTRACT_CITES,
    summary: `Net PMPM moved ${formatCents(overview.netChangeCents)} between the prior and current windows.`,
  };
}

export const getTopSpendSchema = z.object({
  limit: z.number().int().min(1).max(25).optional(),
  by: z.enum(["drug", "class", "both"]).optional(),
});

async function getTopSpend(
  clock: SimulationClock,
  args: z.infer<typeof getTopSpendSchema>,
): Promise<ToolResult> {
  const limit = args.limit ?? 10;
  const by = args.by ?? "both";
  const data: Record<string, unknown> = { asOf: clock.today.toISOString().slice(0, 10) };
  if (by === "drug" || by === "both") {
    data.drugs = await getTopDrugs(clock, limit);
  }
  if (by === "class" || by === "both") {
    data.classes = await getTopClasses(clock, limit);
  }
  const topDrug = (
    data.drugs as { name?: string; billedCents?: number }[] | undefined
  )?.[0];
  return {
    data,
    citations: CONTRACT_CITES,
    summary: topDrug
      ? `Top drug by billed: ${topDrug.name} at ${formatCentsCompact(topDrug.billedCents ?? 0)}.`
      : "No paid claims in the window yet.",
  };
}

export const getSettlementSnapshotSchema = z.object({});

async function getSettlementSnapshot(
  clock: SimulationClock,
): Promise<ToolResult> {
  const [settlement, invoices, rebates] = await Promise.all([
    getSettlementOverview(clock),
    getInvoiceOverview(clock),
    getRebateLedger(clock),
  ]);
  return {
    data: {
      asOf: clock.today.toISOString().slice(0, 10),
      pharmacy: {
        paidToDateCents: settlement.paidToDateCents,
        scheduledCents: settlement.scheduledCents,
        recoveredFromNetworkCents: settlement.recoveredFromNetworkCents,
        cyclesPaid: settlement.cycles.filter((c) => c.status === "Paid").length,
        inFlight: settlement.inFlight
          ? { netCents: settlement.inFlight.netCents, status: settlement.inFlight.status }
          : null,
      },
      sponsor: {
        billedToDateCents: invoices.billedToDateCents,
        adminFeeToDateCents: invoices.adminFeeToDateCents,
        adminFeeShareBps: invoices.adminFeeShareBps,
        adminFeePmpmCents: invoices.adminFeePmpmCents,
        billCount: invoices.bills.length,
      },
      rebates: {
        accruedCents: rebates.accruedCents,
        collectedCents: rebates.collectedCents,
        outstandingCents: rebates.outstandingCents,
        disputedCents: rebates.disputedCents,
      },
    },
    citations: CONTRACT_CITES,
    summary: `Settlement: pharmacy paid ${formatCentsCompact(settlement.paidToDateCents)}, sponsor billed ${formatCentsCompact(invoices.billedToDateCents)}, rebate outstanding ${formatCentsCompact(rebates.outstandingCents)}.`,
  };
}

export const getGuaranteeScorecardSchema = z.object({});

async function getGuaranteeScorecard(
  clock: SimulationClock,
): Promise<ToolResult> {
  const [scorecard, incidents, rebateFloor] = await Promise.all([
    getScorecard(clock),
    getIncidents(clock),
    getRebateFloor(clock),
  ]);
  const missed = scorecard.rows.filter((r) => !r.annualMet);
  return {
    data: {
      asOf: clock.today.toISOString().slice(0, 10),
      scorecard: {
        closedMonths: scorecard.closedMonths,
        totalCreditCents: scorecard.totalCreditCents,
        rows: scorecard.rows.map((r) => ({
          id: r.guarantee.id,
          name: r.guarantee.name,
          annualMeasured: r.annualMeasured,
          annualMet: r.annualMet,
          missedPeriods: r.missedPeriods,
          creditCents: r.creditCents,
          atRiskCents: r.guarantee.atRiskCents,
        })),
      },
      incidents: incidents.slice(0, 10).map((i) => ({
        id: i.id,
        title: i.title,
        severity: i.severity,
        startedAt: i.startedAt.toISOString().slice(0, 10),
        notifiedWithinHours: i.notifiedWithinHours,
        guaranteeId: i.guaranteeId,
      })),
      rebateFloor,
    },
    citations: CONTRACT_CITES,
    summary:
      missed.length === 0
        ? `Operational scorecard: all measures met year-to-date; ${formatCentsCompact(scorecard.totalCreditCents)} in credits posted.`
        : `${missed.length} operational measure(s) short year-to-date; ${formatCentsCompact(scorecard.totalCreditCents)} in credits.`,
  };
}

export const lookupClaimsSchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  channel: z.string().optional(),
  drug: z.string().optional(),
  member: z.string().optional(),
  reject: z.string().optional(),
  page: z.number().int().min(1).optional(),
});

async function lookupClaims(
  clock: SimulationClock,
  args: z.infer<typeof lookupClaimsSchema>,
): Promise<ToolResult> {
  const result = await listClaims(
    {
      q: args.q,
      status: args.status,
      channel: args.channel,
      drug: args.drug,
      member: args.member,
      reject: args.reject,
      page: args.page ?? 1,
      perPage: 15,
    },
    clock,
  );
  const rows = result.rows.map((r) => ({
    id: r.id,
    claimNumber: r.claimNumber,
    dateOfService: r.dateOfService.toISOString().slice(0, 10),
    status: r.responseStatus,
    drug: r.drug.name,
    member: `${r.member.firstName} ${r.member.lastName}`,
    channel: r.channel,
    totalBilledCents: r.totalBilledCents,
    planPaidCents: r.planPaidCents,
    patientPayCents: r.patientPayCents,
    rejectCodes: r.rejectCodes,
  }));
  return {
    data: {
      total: result.total,
      page: result.page,
      rows,
    },
    citations: CONTRACT_CITES,
    summary: `Found ${formatNumber(result.total)} claim(s); showing ${rows.length} on this page.`,
  };
}

export const getClaimDetailSchema = z.object({
  idOrNumber: z.string().describe("Claim id or claim number"),
});

async function getClaimDetailTool(
  args: z.infer<typeof getClaimDetailSchema>,
): Promise<ToolResult> {
  const claim = await getClaimDetail(args.idOrNumber);
  if (!claim) {
    return {
      data: { found: false },
      citations: [],
      summary: `No claim matched “${args.idOrNumber}”.`,
    };
  }
  return {
    data: {
      found: true,
      id: claim.id,
      claimNumber: claim.claimNumber,
      dateOfService: claim.dateOfService.toISOString().slice(0, 10),
      status: claim.responseStatus,
      channel: claim.channel,
      drug: claim.drug.name,
      member: `${claim.member.firstName} ${claim.member.lastName}`,
      memberId: claim.memberId,
      pharmacy: claim.pharmacy.name,
      totalBilledCents: claim.totalBilledCents,
      planPaidCents: claim.planPaidCents,
      patientPayCents: claim.patientPayCents,
      pharmacyPaidCents: claim.pharmacyPaidCents,
      nadacTotalCents: claim.nadacTotalCents,
      estimatedRebateCents: claim.estimatedRebateCents,
      basisOfReimbursement: claim.basisOfReimbursement,
      rejectCodes: claim.rejectCodes,
      rejectMessage: claim.rejectMessage,
    },
    citations: CONTRACT_CITES,
    summary: `Claim ${claim.claimNumber}: ${claim.responseStatus === "P" ? "paid" : "rejected"}, billed ${formatCents(claim.totalBilledCents ?? 0)}.`,
  };
}

export const composeReportBriefingSchema = z.object({
  kind: z.enum([
    "guarantees",
    "rebates",
    "spread",
    "awp",
    "full-year",
    "trends",
    "settlement",
  ]),
});

async function composeReportBriefing(
  clock: SimulationClock,
  args: z.infer<typeof composeReportBriefingSchema>,
): Promise<ToolResult> {
  const asOf = clock.today.toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`# Glass report briefing — ${args.kind}`);
  lines.push(`As of ${asOf} (plan year ${asOf.slice(0, 4)}, ${(clock.yearElapsed * 100).toFixed(0)}% elapsed).`);
  lines.push("");

  if (args.kind === "guarantees" || args.kind === "full-year") {
    const guarantees = await getGuaranteeReconciliation(clock);
    lines.push("## Pricing guarantee reconciliation");
    lines.push(
      "Exhibit C promises an aggregate discount off AWP by channel and drug class. Each row settles alone.",
    );
    for (const g of guarantees) {
      const status =
        g.met === null
          ? "n/a"
          : g.belowMinimumVolume
            ? "below minimum volume"
            : g.met
              ? "met"
              : "short";
      lines.push(
        `- ${g.channel} / ${g.scope}: actual ${bpsLabel(g.actualDiscountBps)} vs guaranteed ${bpsLabel(g.guaranteedBps)} (${status}); dollar variance ${g.dollarVarianceCents == null ? "—" : formatCents(g.dollarVarianceCents)}`,
      );
    }
    lines.push("");
  }

  if (args.kind === "rebates" || args.kind === "full-year") {
    const rebates = await getRebateWaterfall(clock);
    lines.push("## Rebate waterfall");
    lines.push(
      `- Gross rebates: ${formatCents(rebates.grossRebateCents)}`,
    );
    lines.push(
      `- Rebate admin fee: ${formatCents(rebates.rebateAdminFeeCents)}`,
    );
    lines.push(`- Net to plan: ${formatCents(rebates.netToPlanCents)}`);
    lines.push(
      `- Brand floor: ${formatCents(rebates.minGuaranteeCents)} (${rebates.guaranteeMet ? "met" : "short"})`,
    );
    lines.push("");
  }

  if (args.kind === "spread" || args.kind === "full-year") {
    const spread = await getSpreadComparison(clock);
    lines.push("## Spread counterfactual");
    lines.push(
      `Same utilisation under a published traditional schedule would cost ${formatCents(spread.deltaCents)} more than pass-through (${formatCents(spread.passThroughCents)} vs ${formatCents(spread.spreadCents)}).`,
    );
    for (const row of spread.byClass) {
      lines.push(
        `- ${row.brandGeneric}: delta ${formatCents(row.deltaCents)}`,
      );
    }
    lines.push("");
  }

  if (args.kind === "awp" || args.kind === "full-year") {
    const awp = await getAwpSensitivity(clock);
    lines.push("## AWP sensitivity");
    const verifiableShare =
      awp.totalCents > 0 ? awp.verifiableCents / awp.totalCents : 0;
    lines.push(
      `${(awp.awpShare * 100).toFixed(1)}% of billed cost is priced on AWP; verifiable share ${(verifiableShare * 100).toFixed(1)}%.`,
    );
    lines.push("");
  }

  if (args.kind === "trends" || args.kind === "full-year") {
    const overview = await getTrendOverview(clock);
    lines.push("## Trend drivers");
    if (!overview) {
      lines.push("Not enough history for a two-period bridge yet.");
    } else {
      lines.push(
        `Net PMPM change: ${formatCents(overview.netChangeCents)}.`,
      );
      for (const d of overview.drivers) {
        lines.push(`- ${d.label}: ${formatCents(d.cents)} — ${d.note}`);
      }
      const drugs = await getDrugDrivers(overview);
      if (drugs.length > 0) {
        lines.push("Top drug contributors:");
        for (const d of drugs.slice(0, 5)) {
          lines.push(
            `- ${d.label}: ${formatCents(d.changeCents)} PMPM change`,
          );
        }
      }
    }
    lines.push("");
  }

  if (args.kind === "settlement" || args.kind === "full-year") {
    const [settlement, invoices, rebates] = await Promise.all([
      getSettlementOverview(clock),
      getInvoiceOverview(clock),
      getRebateLedger(clock),
    ]);
    lines.push("## Settlement");
    lines.push(
      `- Pharmacy paid to date: ${formatCents(settlement.paidToDateCents)}`,
    );
    lines.push(
      `- Pharmacy scheduled / in flight: ${formatCents(settlement.scheduledCents)}`,
    );
    lines.push(
      `- Sponsor invoice billed to date: ${formatCents(invoices.billedToDateCents)}`,
    );
    lines.push(
      `- Admin fees to date: ${formatCents(invoices.adminFeeToDateCents)}`,
    );
    lines.push(
      `- Rebates accrued ${formatCents(rebates.accruedCents)}, collected ${formatCents(rebates.collectedCents)}, outstanding ${formatCents(rebates.outstandingCents)}`,
    );
    lines.push("");
  }

  if (args.kind === "full-year") {
    const totals = await getBookTotals(clock);
    lines.push("## Book totals");
    lines.push(
      `${formatNumber(totals.members)} members; ${formatNumber(totals.claimsPaid)} paid claims; plan billed ${formatCents(totals.totalBilledCents)}; member OOP ${formatCents(totals.memberPaidCents)}; estimated rebates ${formatCents(totals.rebateCents)}; spread ${formatCents(totals.spreadCents)}.`,
    );
    lines.push("");
  }

  lines.push("---");
  lines.push(
    "Live pages: [/reports](/reports) · [/sponsor](/sponsor) · [/trends](/trends) · [/settlement](/settlement) · [/reconciliation](/reconciliation)",
  );

  const markdown = lines.join("\n");
  return {
    data: { kind: args.kind, asOf, markdown },
    citations: CONTRACT_CITES,
    summary: `Composed a ${args.kind} briefing (${markdown.split("\n").length} lines) from the claim ledger.`,
  };
}

export const getHighCostDrugUmSchema = z.object({
  limit: z
    .number()
    .int()
    .min(5)
    .max(25)
    .optional()
    .describe("How many top drugs by YTD spend to include; default 15"),
});

async function getHighCostDrugUm(
  clock: SimulationClock,
  args: z.infer<typeof getHighCostDrugUmSchema>,
): Promise<ToolResult> {
  const limit = args.limit ?? 15;
  const um = await getHighCostDrugUtilizationManagement(clock, limit);
  const formularyCite = cite(
    "navitus-etf-formulary-2026",
    "Alphabetical index — special code legend (PA, ST, QL, MSP, etc.)",
  );
  const withUm = um.drugs.filter(
    (d) => d.requiresStep || d.requiresPA || d.hasQuantityLimit,
  );
  return {
    data: um,
    citations: [formularyCite],
    summary: `Top ${um.drugCount} drugs by YTD spend through ${um.asOf}: ${um.withStepTherapy} with step therapy, ${um.withPriorAuth} with PA, ${um.withQuantityLimit} with quantity limits (${withUm.length} with any UM rule).`,
  };
}

export const searchFormularyUmSchema = z.object({
  flag: z
    .enum(["step", "pa", "ql", "specialty", "any"])
    .optional()
    .describe("Which UM flag to search; default any active rule"),
  query: z
    .string()
    .optional()
    .describe("Optional drug name substring filter"),
  limit: z.number().int().min(5).max(50).optional(),
});

async function searchFormularyUm(
  clock: SimulationClock,
  args: z.infer<typeof searchFormularyUmSchema>,
): Promise<ToolResult> {
  const result = await searchFormularyUtilizationManagement(clock, {
    flag: (args.flag ?? "any") as UmSearchFlag,
    query: args.query,
    limit: args.limit ?? 25,
  });
  const formularyCite = cite(
    "navitus-etf-formulary-2026",
    "Alphabetical index — special code legend (PA, ST, QL, MSP, etc.)",
  );
  const label =
    result.flag === "any"
      ? "any UM rule"
      : result.flag === "step"
        ? "step therapy"
        : result.flag === "pa"
          ? "prior authorization"
          : result.flag === "ql"
            ? "quantity limit"
            : "mandatory specialty";
  return {
    data: result,
    citations: [formularyCite],
    summary: `${formatNumber(result.totalMatching)} formulary product(s) with ${label}; showing ${result.returned}.`,
  };
}

export const getPriorAuthOverviewSchema = z.object({});

async function getPriorAuthOverview(
  clock: SimulationClock,
): Promise<ToolResult> {
  const stats = await getPriorAuthQueueStats(clock);
  const paCite = cite("navitus-pa-process", "Prior authorization turnaround");
  const approvalRate =
    stats.total > 0 ? Math.round((stats.approved / stats.total) * 1000) / 10 : 0;
  return {
    data: {
      asOf: clock.today.toISOString().slice(0, 10),
      ...stats,
      approvalRatePct: approvalRate,
    },
    citations: [paCite, cite("navitus-pa-forms", "Published PA criteria forms")],
    summary: `${formatNumber(stats.total)} PA determinations through ${clock.today.toISOString().slice(0, 10)}: ${formatNumber(stats.approved)} approved, ${formatNumber(stats.denied)} denied, ${formatNumber(stats.pending)} pending; ${formatNumber(stats.byAi)} decided by AI, ${formatNumber(stats.cited)} with criteria citations.`,
  };
}

export const getMacOverviewSchema = z.object({});

async function getMacOverviewTool(
  clock: SimulationClock,
): Promise<ToolResult> {
  const [mac, appeals] = await Promise.all([
    getMacOverview(clock),
    getAppealOverview(clock),
  ]);
  return {
    data: {
      asOf: clock.today.toISOString().slice(0, 10),
      mac: {
        liveVersion: mac.liveVersion,
        drugCount: mac.drugCount,
        macClaims: mac.macClaims,
        totalClaims: mac.totalClaims,
        macPaidCents: mac.macPaidCents,
        networkMarginCents: mac.networkMarginCents,
        topRows: mac.topRows.slice(0, 8),
      },
      appeals: {
        total: appeals.total,
        underReview: appeals.underReview,
        upheld: appeals.upheld,
        overturned: appeals.overturned,
        overturnRateBps: appeals.overturnRateBps,
        adjustmentCents: appeals.adjustmentCents,
        medianResolutionDays: appeals.medianResolutionDays,
        withinStatute: appeals.withinStatute,
        outsideStatute: appeals.outsideStatute,
        denialsWithCitation: appeals.denialsWithCitation,
        denials: appeals.denials,
        recent: appeals.recent.slice(0, 5),
      },
    },
    citations: [
      {
        sourceId: "wis-stat-632-865",
        title: "Wis. Stat. § 632.865 — MAC appeals",
        publisher: "Wisconsin Legislature",
        url: "https://docs.legis.wisconsin.gov/statutes/statutes/632/865",
        locator: "632.865(2)(b)",
      },
    ],
    summary: `MAC list v${mac.liveVersion} covers ${formatNumber(mac.drugCount)} products; ${formatNumber(appeals.total)} appeals filed (${formatNumber(appeals.overturned)} overturned, ${formatNumber(appeals.withinStatute)} resolved within 21 days).`,
  };
}

export const getMemberExperienceSchema = z.object({});

async function getMemberExperience(
  clock: SimulationClock,
): Promise<ToolResult> {
  const reading = await getCurrentReading(clock);
  const topDriver = reading.drivers[0];
  return {
    data: {
      asOf: clock.today.toISOString().slice(0, 10),
      censusNps: reading.census.nps,
      censusScored: reading.census.scored,
      promoters: reading.census.promoters,
      passives: reading.census.passives,
      detractors: reading.census.detractors,
      surveyedNps: reading.surveyed.nps,
      excluded: reading.excluded,
      topDrivers: reading.drivers.slice(0, 6),
      topThemes: reading.themes.slice(0, 5),
    },
    citations: CONTRACT_CITES,
    summary: `Census NPS ${reading.census.nps} across ${formatNumber(reading.census.scored)} scored members${topDriver ? `; top driver ${topDriver.id} (${formatNumber(topDriver.membersAffected)} members)` : ""}.`,
  };
}

export const getIntegrityOverviewSchema = z.object({});

async function getIntegrityOverviewTool(
  clock: SimulationClock,
): Promise<ToolResult> {
  const overview = await getIntegrityOverview(clock);
  const top = overview.signals.slice(0, 8);
  return {
    data: {
      asOf: clock.today.toISOString().slice(0, 10),
      bySeverity: overview.bySeverity,
      totalExposureCents: overview.totalExposureCents,
      claimsScreened: overview.claimsScreened,
      membersScreened: overview.membersScreened,
      plantedFound: overview.plantedFound,
      plantedTotal: overview.plantedTotal,
      topSignals: top.map((s) => ({
        id: s.id,
        detector: s.detector.name,
        subjectLabel: s.subjectLabel,
        severity: s.severity,
        score: s.score,
        exposureCents: s.exposureCents,
        claimCount: s.claimCount,
      })),
    },
    citations: CONTRACT_CITES,
    summary: `${formatNumber(overview.signals.length)} integrity signal(s): ${overview.bySeverity.high} high, ${overview.bySeverity.elevated} elevated; ${formatCentsCompact(overview.totalExposureCents)} exposure above watch.`,
  };
}

export const getRejectOverviewSchema = z.object({});

async function getRejectOverview(
  clock: SimulationClock,
): Promise<ToolResult> {
  const rejects = await getRejectMix(clock);
  const totalClaims = rejects.reduce((s, r) => s + r.claims, 0);
  return {
    data: {
      asOf: clock.today.toISOString().slice(0, 10),
      totalRejectedClaims: totalClaims,
      codes: rejects.slice(0, 12),
    },
    citations: CONTRACT_CITES,
    summary:
      rejects[0]
        ? `${formatNumber(totalClaims)} rejected claim(s); top code ${rejects[0].code} (${formatNumber(rejects[0].claims)} claims, ${formatNumber(rejects[0].members)} members).`
        : "No rejected claims in the window.",
  };
}

export const getClinicalOverviewSchema = z.object({});

async function getClinicalOverviewTool(
  clock: SimulationClock,
): Promise<ToolResult> {
  const clinical = await getClinicalOverview(clock);
  return {
    data: {
      asOf: clock.today.toISOString().slice(0, 10),
      claimsScreened: clinical.claimsScreened,
      membersScreened: clinical.membersScreened,
      totalAlerts: clinical.totalAlerts,
      majorAlerts: clinical.majorAlerts,
      membersAffected: clinical.membersAffected,
      byCode: clinical.byCode,
      dose: clinical.dose,
      topInteractions: clinical.interactions
        .filter((i) => i.alerts > 0)
        .slice(0, 5)
        .map((i) => ({
          rule: `${i.rule.a.label} + ${i.rule.b.label}`,
          alerts: i.alerts,
          members: i.members,
        })),
    },
    citations: CONTRACT_CITES,
    summary: `${formatNumber(clinical.totalAlerts)} clinical alert(s) on ${formatNumber(clinical.claimsScreened)} paid claims; ${formatNumber(clinical.membersAffected)} members affected; ${formatNumber(clinical.dose.atCeiling)} at opioid MME ceiling.`,
  };
}

export const getEligibilityOverviewSchema = z.object({});

async function getEligibilityOverview(
  clock: SimulationClock,
): Promise<ToolResult> {
  const feed = await getFeedOverview(clock);
  return {
    data: {
      asOf: clock.today.toISOString().slice(0, 10),
      livesOnFile: feed.livesOnFile,
      filesReceived: feed.filesReceived,
      transactionsApplied: feed.transactionsApplied,
      adds: feed.adds,
      changes: feed.changes,
      terms: feed.terms,
      rejected: feed.rejected,
      openRejects: feed.openRejects,
      resolvedRejects: feed.resolvedRejects,
      medianTurnaroundHours: feed.medianTurnaroundHours,
      recentFiles: feed.files.slice(0, 5),
    },
    citations: CONTRACT_CITES,
    summary: `${formatNumber(feed.livesOnFile)} lives on file; ${formatNumber(feed.rejected)} eligibility transaction reject(s) (${formatNumber(feed.openRejects)} open); median file turnaround ${feed.medianTurnaroundHours}h.`,
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export type DataToolName =
  | "getBookSnapshot"
  | "getContractReports"
  | "getTrendDrivers"
  | "getTopSpend"
  | "getSettlementSnapshot"
  | "getGuaranteeScorecard"
  | "getHighCostDrugUm"
  | "searchFormularyUm"
  | "getPriorAuthOverview"
  | "getMacOverview"
  | "getMemberExperience"
  | "getIntegrityOverview"
  | "getRejectOverview"
  | "getClinicalOverview"
  | "getEligibilityOverview"
  | "lookupClaims"
  | "getClaimDetail"
  | "composeReportBriefing";

type AnySchema = z.ZodType<unknown>;

interface DataToolDef {
  schema: AnySchema;
  execute: (args: unknown, clock: SimulationClock) => Promise<ToolResult>;
}

export const DATA_TOOL_REGISTRY: Record<DataToolName, DataToolDef> = {
  getBookSnapshot: {
    schema: getBookSnapshotSchema,
    execute: (_a, clock) => getBookSnapshot(clock),
  },
  getContractReports: {
    schema: getContractReportsSchema,
    execute: (a, clock) =>
      getContractReports(clock, a as z.infer<typeof getContractReportsSchema>),
  },
  getTrendDrivers: {
    schema: getTrendDriversSchema,
    execute: (_a, clock) => getTrendDriversTool(clock),
  },
  getTopSpend: {
    schema: getTopSpendSchema,
    execute: (a, clock) =>
      getTopSpend(clock, a as z.infer<typeof getTopSpendSchema>),
  },
  getSettlementSnapshot: {
    schema: getSettlementSnapshotSchema,
    execute: (_a, clock) => getSettlementSnapshot(clock),
  },
  getGuaranteeScorecard: {
    schema: getGuaranteeScorecardSchema,
    execute: (_a, clock) => getGuaranteeScorecard(clock),
  },
  getHighCostDrugUm: {
    schema: getHighCostDrugUmSchema,
    execute: (a, clock) =>
      getHighCostDrugUm(clock, a as z.infer<typeof getHighCostDrugUmSchema>),
  },
  searchFormularyUm: {
    schema: searchFormularyUmSchema,
    execute: (a, clock) =>
      searchFormularyUm(clock, a as z.infer<typeof searchFormularyUmSchema>),
  },
  getPriorAuthOverview: {
    schema: getPriorAuthOverviewSchema,
    execute: (_a, clock) => getPriorAuthOverview(clock),
  },
  getMacOverview: {
    schema: getMacOverviewSchema,
    execute: (_a, clock) => getMacOverviewTool(clock),
  },
  getMemberExperience: {
    schema: getMemberExperienceSchema,
    execute: (_a, clock) => getMemberExperience(clock),
  },
  getIntegrityOverview: {
    schema: getIntegrityOverviewSchema,
    execute: (_a, clock) => getIntegrityOverviewTool(clock),
  },
  getRejectOverview: {
    schema: getRejectOverviewSchema,
    execute: (_a, clock) => getRejectOverview(clock),
  },
  getClinicalOverview: {
    schema: getClinicalOverviewSchema,
    execute: (_a, clock) => getClinicalOverviewTool(clock),
  },
  getEligibilityOverview: {
    schema: getEligibilityOverviewSchema,
    execute: (_a, clock) => getEligibilityOverview(clock),
  },
  lookupClaims: {
    schema: lookupClaimsSchema,
    execute: (a, clock) =>
      lookupClaims(clock, a as z.infer<typeof lookupClaimsSchema>),
  },
  getClaimDetail: {
    schema: getClaimDetailSchema,
    execute: (a) =>
      getClaimDetailTool(a as z.infer<typeof getClaimDetailSchema>),
  },
  composeReportBriefing: {
    schema: composeReportBriefingSchema,
    execute: (a, clock) =>
      composeReportBriefing(
        clock,
        a as z.infer<typeof composeReportBriefingSchema>,
      ),
  },
};
