/**
 * Turn data-agent tool results into sponsor-facing paragraphs.
 *
 * Templates only. Optional LLM narration in the agent layer may restate these
 * paragraphs, but must not introduce figures that are not already here.
 */

import { formatCents, formatCentsCompact } from "@/lib/money";
import { formatNumber } from "@/lib/utils";
import type { Citation, ToolResult } from "./tools";
import type { DataIntent } from "./data-plan";

export interface DataToolRun {
  tool: string;
  args: unknown;
  because: string;
  error: string | null;
  result: ToolResult | null;
}

export interface DataComposeResult {
  paragraphs: string[];
  citations: Citation[];
  links: { label: string; href: string }[];
  /** Markdown briefing body when composeReportBriefing ran. */
  briefingMarkdown: string | null;
  handoff: string | null;
}

function dataOf(runs: DataToolRun[], tool: string): Record<string, unknown> | null {
  const hit = runs.find((r) => r.tool === tool && r.result && !r.error);
  if (!hit?.result) return null;
  return hit.result.data as Record<string, unknown>;
}

function mergeCitations(runs: DataToolRun[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const r of runs) {
    for (const c of r.result?.citations ?? []) {
      const key = `${c.sourceId}:${c.locator ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

function bps(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(n / 100).toFixed(2)}%`;
}

export function composeDataAnswer(
  question: string,
  intent: DataIntent,
  runs: DataToolRun[],
): DataComposeResult {
  const citations = mergeCitations(runs);
  const briefing = dataOf(runs, "composeReportBriefing");
  const briefingMarkdown =
    typeof briefing?.markdown === "string" ? briefing.markdown : null;

  if (runs.every((r) => r.error || !r.result)) {
    return {
      paragraphs: [
        "I could not answer from the plan's data. Try asking about book totals, guarantees, rebates, trends, settlement, prior auth, MAC appeals, member NPS, integrity signals, formulary rules, or a specific claim number.",
      ],
      citations: [],
      links: [
        { label: "Sponsor dashboard", href: "/sponsor" },
        { label: "Contract reports", href: "/reports" },
      ],
      briefingMarkdown: null,
      handoff: "no-data",
    };
  }

  const paragraphs: string[] = [];
  const links: { label: string; href: string }[] = [];

  switch (intent) {
    case "book-totals": {
      const snap = dataOf(runs, "getBookSnapshot");
      const totals = snap?.totals as
        | {
            members: number;
            claimsPaid: number;
            totalBilledCents: number;
            planPaidCents: number;
            memberPaidCents: number;
            rebateCents: number;
            spreadCents: number;
            specialtyBilledCents: number;
          }
        | undefined;
      if (totals) {
        paragraphs.push(
          `Through ${String(snap?.asOf ?? "today")}, the book has ${formatNumber(totals.members)} members and ${formatNumber(totals.claimsPaid)} paid claims.`,
        );
        paragraphs.push(
          `Plan billed ${formatCentsCompact(totals.totalBilledCents)} (${formatCents(totals.totalBilledCents)}); members paid ${formatCentsCompact(totals.memberPaidCents)} at the counter; estimated rebates ${formatCentsCompact(totals.rebateCents)}. Spread is ${formatCents(totals.spreadCents)}.`,
        );
        paragraphs.push(
          `Specialty billed ${formatCentsCompact(totals.specialtyBilledCents)}. Every total above is a sum over claims on the sponsor rollup.`,
        );
      }
      links.push(
        { label: "Sponsor dashboard", href: "/sponsor" },
        { label: "Claim ledger", href: "/claims" },
      );
      break;
    }
    case "guarantees": {
      const reports = dataOf(runs, "getContractReports");
      const rows = (reports?.guarantees as
        | {
            channel: string;
            scope: string;
            met: boolean | null;
            actualDiscountBps: number;
            guaranteedBps: number | null;
            dollarVarianceCents: number | null;
            belowMinimumVolume: boolean;
          }[]
        | undefined) ?? [];
      const missed = rows.filter((g) => g.met === false);
      paragraphs.push(
        missed.length === 0
          ? "Every pricing guarantee category that has enough volume is at or above the Exhibit C discount."
          : `${missed.length} pricing guarantee categor${missed.length === 1 ? "y is" : "ies are"} short of the Exhibit C discount.`,
      );
      for (const g of missed.slice(0, 6)) {
        paragraphs.push(
          `${g.channel} / ${g.scope}: actual ${bps(g.actualDiscountBps)} vs guaranteed ${bps(g.guaranteedBps)}; dollar variance ${g.dollarVarianceCents == null ? "—" : formatCents(g.dollarVarianceCents)}${g.belowMinimumVolume ? " (below minimum volume)" : ""}.`,
        );
      }
      if (briefingMarkdown) {
        paragraphs.push(
          "A full guarantees briefing is attached below; open Contract reports for the live table.",
        );
      }
      links.push(
        { label: "Contract reports", href: "/reports" },
        { label: "Guarantee reconciliation", href: "/reconciliation" },
      );
      break;
    }
    case "rebates": {
      const reports = dataOf(runs, "getContractReports");
      const r = reports?.rebates as
        | {
            grossRebateCents: number;
            rebateAdminFeeCents: number;
            netToPlanCents: number;
            minGuaranteeCents: number;
            guaranteeMet: boolean;
          }
        | undefined;
      if (r) {
        paragraphs.push(
          `Gross rebates ${formatCentsCompact(r.grossRebateCents)}; rebate admin ${formatCentsCompact(r.rebateAdminFeeCents)}; net to plan ${formatCentsCompact(r.netToPlanCents)}.`,
        );
        paragraphs.push(
          `Brand floor ${formatCentsCompact(r.minGuaranteeCents)} — ${r.guaranteeMet ? "met" : "short"}.`,
        );
      }
      links.push({ label: "Rebate waterfall", href: "/reports" });
      break;
    }
    case "spread": {
      const reports = dataOf(runs, "getContractReports");
      const s = reports?.spread as
        | {
            passThroughCents: number;
            spreadCents: number;
            deltaCents: number;
          }
        | undefined;
      if (s) {
        paragraphs.push(
          `Under this pass-through book the plan is billed ${formatCentsCompact(s.passThroughCents)}. The same utilisation under a published traditional spread schedule would cost ${formatCentsCompact(s.spreadCents)} — a difference of ${formatCentsCompact(s.deltaCents)}.`,
        );
        paragraphs.push(
          "That gap is a calculation on identical claims, not a brochure estimate.",
        );
      }
      links.push({ label: "Spread comparison", href: "/reports" });
      break;
    }
    case "awp": {
      const reports = dataOf(runs, "getContractReports");
      const a = reports?.awp as
        | { awpShare: number; awpPricedCents: number; totalCents: number }
        | undefined;
      if (a) {
        paragraphs.push(
          `${(a.awpShare * 100).toFixed(1)}% of billed cost (${formatCentsCompact(a.awpPricedCents)} of ${formatCentsCompact(a.totalCents)}) is priced on AWP — the unverifiable arm of lesser-of.`,
        );
      }
      links.push({ label: "AWP sensitivity", href: "/reports" });
      break;
    }
    case "trends": {
      const trend = dataOf(runs, "getTrendDrivers");
      if (trend?.available === false) {
        paragraphs.push(String(runs.find((r) => r.tool === "getTrendDrivers")?.result?.summary ?? "Trend bridge not available yet."));
      } else if (trend) {
        paragraphs.push(
          `Net PMPM moved ${formatCents(Number(trend.netChangeCents ?? 0))} between the prior and current windows.`,
        );
        const drivers = (trend.drivers as { label: string; cents: number; note: string }[]) ?? [];
        for (const d of drivers.slice(0, 5)) {
          paragraphs.push(`${d.label}: ${formatCents(d.cents)}. ${d.note}`);
        }
        const topDrugs = (trend.topDrugs as { label: string; changeCents: number }[]) ?? [];
        if (topDrugs[0]) {
          paragraphs.push(
            `Largest drug contributor: ${topDrugs[0].label} (${formatCents(topDrugs[0].changeCents)} PMPM).`,
          );
        }
      }
      links.push(
        { label: "Trend management", href: "/trends" },
        { label: "Change console", href: "/changes" },
      );
      break;
    }
    case "top-spend": {
      const top = dataOf(runs, "getTopSpend");
      const drugs = (top?.drugs as { name: string; billedCents: number; claims: number }[]) ?? [];
      if (drugs.length > 0) {
        paragraphs.push("Top drugs by billed amount:");
        for (const d of drugs.slice(0, 8)) {
          paragraphs.push(
            `${d.name}: ${formatCentsCompact(d.billedCents)} across ${formatNumber(d.claims)} claims.`,
          );
        }
      }
      const classes = (top?.classes as { therapeuticClass: string; billedCents: number }[]) ?? [];
      if (classes[0]) {
        paragraphs.push(
          `Largest therapeutic class: ${classes[0].therapeuticClass} at ${formatCentsCompact(classes[0].billedCents)}.`,
        );
      }
      links.push({ label: "Sponsor dashboard", href: "/sponsor" });
      break;
    }
    case "settlement": {
      const snap = dataOf(runs, "getSettlementSnapshot");
      const pharmacy = snap?.pharmacy as
        | { paidToDateCents: number; scheduledCents: number }
        | undefined;
      const sponsor = snap?.sponsor as
        | { billedToDateCents: number; adminFeeToDateCents: number }
        | undefined;
      const rebates = snap?.rebates as
        | { accruedCents: number; outstandingCents: number }
        | undefined;
      if (pharmacy && sponsor && rebates) {
        paragraphs.push(
          `Pharmacy remittance paid to date ${formatCentsCompact(pharmacy.paidToDateCents)}; scheduled or in flight ${formatCentsCompact(pharmacy.scheduledCents)}.`,
        );
        paragraphs.push(
          `Sponsor invoices billed ${formatCentsCompact(sponsor.billedToDateCents)} (admin fees ${formatCentsCompact(sponsor.adminFeeToDateCents)}).`,
        );
        paragraphs.push(
          `Rebates accrued ${formatCentsCompact(rebates.accruedCents)}; outstanding ${formatCentsCompact(rebates.outstandingCents)}.`,
        );
      }
      links.push({ label: "Settlement", href: "/settlement" });
      break;
    }
    case "scorecard": {
      const score = dataOf(runs, "getGuaranteeScorecard");
      const card = score?.scorecard as
        | {
            totalCreditCents: number;
            rows: {
              name: string;
              annualMet: boolean;
              annualMeasured: number;
              creditCents: number;
            }[];
          }
        | undefined;
      if (card) {
        const missed = card.rows.filter((r) => !r.annualMet);
        paragraphs.push(
          missed.length === 0
            ? `Operational scorecard: all measures met year-to-date. Credits posted: ${formatCentsCompact(card.totalCreditCents)}.`
            : `${missed.length} operational measure(s) short year-to-date. Credits posted: ${formatCentsCompact(card.totalCreditCents)}.`,
        );
        for (const r of missed.slice(0, 5)) {
          paragraphs.push(
            `${r.name}: measured ${r.annualMeasured.toFixed(1)}%; credit ${formatCents(r.creditCents)}.`,
          );
        }
      }
      const incidents = (score?.incidents as { title: string; severity: string }[]) ?? [];
      if (incidents[0]) {
        paragraphs.push(
          `Latest incident on file: ${incidents[0].title} (${incidents[0].severity}).`,
        );
      }
      links.push({ label: "Guarantee reconciliation", href: "/reconciliation" });
      break;
    }
    case "formulary-um": {
      const um = dataOf(runs, "getHighCostDrugUm");
      const drugs =
        (um?.drugs as {
          name: string;
          billedCents: number;
          level: string;
          specialCode: string | null;
          prioritizations: string[];
          requiresStep: boolean;
          requiresPA: boolean;
        }[]) ?? [];
      if (drugs.length === 0) {
        paragraphs.push(
          "No high-cost drugs with formulary data were found for the current book window.",
        );
      } else {
        paragraphs.push(
          `Among the top ${formatNumber(Number(um?.drugCount ?? drugs.length))} drugs by YTD spend through ${String(um?.asOf ?? "today")}: ${formatNumber(Number(um?.withStepTherapy ?? 0))} require step therapy, ${formatNumber(Number(um?.withPriorAuth ?? 0))} require prior authorization, ${formatNumber(Number(um?.withQuantityLimit ?? 0))} have quantity limits.`,
        );
        for (const d of drugs) {
          const flags = d.prioritizations.join("; ");
          const code = d.specialCode ? ` [${d.specialCode}]` : "";
          paragraphs.push(
            `${d.name}${code} — Level ${d.level}, ${formatCentsCompact(d.billedCents)} YTD: ${flags}.`,
          );
        }
      }
      const search = dataOf(runs, "searchFormularyUm");
      const catalog =
        (search?.drugs as { name: string; prioritizations: string[] }[]) ?? [];
      if (catalog.length > 0) {
        paragraphs.push(
          `Formulary index: ${formatNumber(Number(search?.totalMatching ?? catalog.length))} product(s) match the requested UM flag; sample:`,
        );
        for (const d of catalog.slice(0, 8)) {
          paragraphs.push(`${d.name}: ${d.prioritizations.join("; ")}.`);
        }
      }
      links.push(
        { label: "Prior authorization", href: "/pa" },
        { label: "Change console", href: "/changes" },
        { label: "Sponsor top drugs", href: "/sponsor" },
      );
      break;
    }
    case "formulary-search": {
      const search = dataOf(runs, "searchFormularyUm");
      const catalog =
        (search?.drugs as {
          name: string;
          level: string;
          specialCode: string | null;
          prioritizations: string[];
        }[]) ?? [];
      if (catalog.length === 0) {
        paragraphs.push("No formulary products matched that UM filter.");
      } else {
        paragraphs.push(
          `${formatNumber(Number(search?.totalMatching ?? 0))} product(s) on the published formulary carry the requested rule; showing ${catalog.length}:`,
        );
        for (const d of catalog.slice(0, 12)) {
          const code = d.specialCode ? ` [${d.specialCode}]` : "";
          paragraphs.push(
            `${d.name}${code} — Level ${d.level}: ${d.prioritizations.join("; ")}.`,
          );
        }
      }
      links.push(
        { label: "Prior authorization", href: "/pa" },
        { label: "Change console", href: "/changes" },
      );
      break;
    }
    case "prior-auth": {
      const pa = dataOf(runs, "getPriorAuthOverview");
      if (pa) {
        paragraphs.push(
          `Through ${String(pa.asOf ?? "today")}: ${formatNumber(Number(pa.total ?? 0))} prior authorization determinations — ${formatNumber(Number(pa.approved ?? 0))} approved, ${formatNumber(Number(pa.denied ?? 0))} denied, ${formatNumber(Number(pa.pending ?? 0))} still pending.`,
        );
        paragraphs.push(
          `${formatNumber(Number(pa.byAi ?? 0))} decided by AI; ${formatNumber(Number(pa.byHuman ?? 0))} by pharmacists; ${formatNumber(Number(pa.expedited ?? 0))} expedited; ${formatNumber(Number(pa.cited ?? 0))} cite a published criteria step.`,
        );
      }
      links.push({ label: "PA queue", href: "/pa" });
      break;
    }
    case "mac": {
      const mac = dataOf(runs, "getMacOverview");
      const list = mac?.mac as
        | {
            liveVersion: number;
            drugCount: number;
            macClaims: number;
            totalClaims: number;
            networkMarginCents: number;
          }
        | undefined;
      const appeals = mac?.appeals as
        | {
            total: number;
            overturned: number;
            withinStatute: number;
            outsideStatute: number;
            medianResolutionDays: number;
            adjustmentCents: number;
          }
        | undefined;
      if (list) {
        paragraphs.push(
          `Live MAC list v${list.liveVersion} covers ${formatNumber(list.drugCount)} products; ${formatNumber(list.macClaims)} of ${formatNumber(list.totalClaims)} paid claims priced on the ceiling; disclosed network margin ${formatCentsCompact(list.networkMarginCents)}.`,
        );
      }
      if (appeals) {
        paragraphs.push(
          `${formatNumber(appeals.total)} appeals filed — ${formatNumber(appeals.overturned)} overturned; median resolution ${appeals.medianResolutionDays} days (${formatNumber(appeals.withinStatute)} within 21 days, ${formatNumber(appeals.outsideStatute)} outside); adjustments ${formatCentsCompact(appeals.adjustmentCents)}.`,
        );
      }
      links.push({ label: "MAC and appeals", href: "/mac" });
      break;
    }
    case "member-experience": {
      const mx = dataOf(runs, "getMemberExperience");
      if (mx) {
        paragraphs.push(
          `Census NPS ${Number(mx.censusNps ?? 0)} across ${formatNumber(Number(mx.censusScored ?? 0))} scored members (${formatNumber(Number(mx.promoters ?? 0))} promoters, ${formatNumber(Number(mx.passives ?? 0))} passives, ${formatNumber(Number(mx.detractors ?? 0))} detractors).`,
        );
        const drivers =
          (mx.topDrivers as { id: string; membersAffected: number; totalPoints: number }[]) ??
          [];
        if (drivers[0]) {
          paragraphs.push(
            `Top rubric driver: ${drivers[0].id} (${formatNumber(drivers[0].membersAffected)} members, ${drivers[0].totalPoints} total points).`,
          );
        }
      }
      links.push({ label: "Member experience", href: "/nps" });
      break;
    }
    case "integrity": {
      const integrity = dataOf(runs, "getIntegrityOverview");
      const sev = integrity?.bySeverity as
        | { high: number; elevated: number; watch: number }
        | undefined;
      const signals =
        (integrity?.topSignals as {
          subjectLabel: string;
          detector: string;
          severity: string;
          exposureCents: number;
        }[]) ?? [];
      if (sev) {
        paragraphs.push(
          `Program integrity: ${formatNumber(sev.high)} high, ${formatNumber(sev.elevated)} elevated, ${formatNumber(sev.watch)} watch signals; ${formatCentsCompact(Number(integrity?.totalExposureCents ?? 0))} exposure above watch.`,
        );
      }
      for (const s of signals.slice(0, 5)) {
        paragraphs.push(
          `${s.subjectLabel} — ${s.detector} (${s.severity}, ${formatCentsCompact(s.exposureCents)} exposure).`,
        );
      }
      links.push({ label: "Program integrity", href: "/integrity" });
      break;
    }
    case "claim-rejects": {
      const rejects = dataOf(runs, "getRejectOverview");
      const codes =
        (rejects?.codes as {
          code: string;
          message: string;
          claims: number;
          members: number;
        }[]) ?? [];
      paragraphs.push(
        `${formatNumber(Number(rejects?.totalRejectedClaims ?? 0))} rejected claim(s) in the book window.`,
      );
      for (const r of codes.slice(0, 8)) {
        paragraphs.push(
          `${r.code}: ${formatNumber(r.claims)} claims, ${formatNumber(r.members)} members${r.message ? ` — ${r.message}` : ""}.`,
        );
      }
      links.push({ label: "Claim ledger", href: "/claims" });
      break;
    }
    case "clinical": {
      const clinical = dataOf(runs, "getClinicalOverview");
      if (clinical) {
        paragraphs.push(
          `${formatNumber(Number(clinical.totalAlerts ?? 0))} clinical alert(s) on ${formatNumber(Number(clinical.claimsScreened ?? 0))} paid claims; ${formatNumber(Number(clinical.membersAffected ?? 0))} members affected.`,
        );
        const dose = clinical.dose as
          | { atCeiling: number; atReassess: number; members: number }
          | undefined;
        if (dose) {
          paragraphs.push(
            `Opioid MME: ${formatNumber(dose.atCeiling)} members at ceiling, ${formatNumber(dose.atReassess)} at reassess threshold.`,
          );
        }
      }
      links.push({ label: "Clinical screening", href: "/clinical" });
      break;
    }
    case "eligibility": {
      const feed = dataOf(runs, "getEligibilityOverview");
      if (feed) {
        paragraphs.push(
          `${formatNumber(Number(feed.livesOnFile ?? 0))} lives on file; ${formatNumber(Number(feed.filesReceived ?? 0))} eligibility files received; ${formatNumber(Number(feed.transactionsApplied ?? 0))} transactions applied.`,
        );
        paragraphs.push(
          `${formatNumber(Number(feed.rejected ?? 0))} transaction reject(s) — ${formatNumber(Number(feed.openRejects ?? 0))} open, ${formatNumber(Number(feed.resolvedRejects ?? 0))} resolved; median turnaround ${Number(feed.medianTurnaroundHours ?? 0)} hours.`,
        );
      }
      links.push({ label: "Eligibility feed", href: "/eligibility" });
      break;
    }
    case "claim-detail": {
      const detail = dataOf(runs, "getClaimDetail");
      if (detail?.found) {
        paragraphs.push(
          `Claim ${String(detail.claimNumber)} for ${String(detail.member)} — ${String(detail.drug)} on ${String(detail.dateOfService)}.`,
        );
        paragraphs.push(
          `Status ${String(detail.status)}; billed ${formatCents(Number(detail.totalBilledCents ?? 0))}; plan paid ${formatCents(Number(detail.planPaidCents ?? 0))}; member paid ${formatCents(Number(detail.patientPayCents ?? 0))}.`,
        );
        links.push({
          label: "Open claim",
          href: `/claims/${String(detail.id)}`,
        });
      } else {
        const list = dataOf(runs, "lookupClaims");
        const rows = (list?.rows as { claimNumber: string; drug: string; totalBilledCents: number; id: string }[]) ?? [];
        paragraphs.push(
          list
            ? `No specific claim number matched. Here are ${rows.length} recent claims from the ledger (of ${formatNumber(Number(list.total ?? 0))}).`
            : "No claim matched that reference.",
        );
        for (const r of rows.slice(0, 5)) {
          paragraphs.push(
            `${r.claimNumber}: ${r.drug} — ${formatCentsCompact(r.totalBilledCents)}.`,
          );
        }
        links.push({ label: "Claim ledger", href: "/claims" });
      }
      break;
    }
    case "claim-lookup": {
      const list = dataOf(runs, "lookupClaims");
      const rows = (list?.rows as { claimNumber: string; drug: string; member: string; status: string; totalBilledCents: number; id: string }[]) ?? [];
      paragraphs.push(
        `Found ${formatNumber(Number(list?.total ?? 0))} claim(s). Showing ${rows.length}:`,
      );
      for (const r of rows.slice(0, 8)) {
        paragraphs.push(
          `${r.claimNumber} · ${r.member} · ${r.drug} · ${r.status} · ${formatCentsCompact(r.totalBilledCents)}`,
        );
      }
      if (rows[0]) {
        links.push({ label: "Open first claim", href: `/claims/${rows[0].id}` });
      }
      links.push({ label: "Claim ledger", href: "/claims" });
      break;
    }
    case "full-report": {
      const snap = dataOf(runs, "getBookSnapshot");
      const totals = snap?.totals as
        | { totalBilledCents: number; rebateCents: number; claimsPaid: number }
        | undefined;
      if (totals) {
        paragraphs.push(
          `Year-to-date briefing for Steel Potatoes: ${formatNumber(totals.claimsPaid)} paid claims, plan billed ${formatCentsCompact(totals.totalBilledCents)}, estimated rebates ${formatCentsCompact(totals.rebateCents)}.`,
        );
      }
      paragraphs.push(
        "The full markdown briefing below mirrors the contract report cards — guarantees, rebates, spread, AWP, trends, and settlement — each recomputed from the claim ledger.",
      );
      links.push(
        { label: "Contract reports", href: "/reports" },
        { label: "Sponsor dashboard", href: "/sponsor" },
        { label: "Trends", href: "/trends" },
        { label: "Settlement", href: "/settlement" },
      );
      break;
    }
    default: {
      const snap = dataOf(runs, "getBookSnapshot");
      if (snap?.totals) {
        const totals = snap.totals as {
          totalBilledCents: number;
          claimsPaid: number;
        };
        paragraphs.push(
          `I started with the book snapshot: ${formatNumber(totals.claimsPaid)} paid claims, plan billed ${formatCentsCompact(totals.totalBilledCents)}.`,
        );
      }
      paragraphs.push(
        `Ask about book totals, guarantees, rebates, spread, trends, top drugs, settlement, the operational scorecard, prior auth, MAC appeals, member NPS, program integrity, claim reject codes, clinical alerts, eligibility feed rejects, formulary step therapy / PA rules, or say “write the year-end report briefing.” (You asked: “${question.trim()}”.)`,
      );
      links.push(
        { label: "Sponsor dashboard", href: "/sponsor" },
        { label: "Contract reports", href: "/reports" },
      );
    }
  }

  if (briefingMarkdown && !paragraphs.some((p) => p.includes("briefing"))) {
    paragraphs.push("A structured briefing was composed from the same tools; see below.");
  }

  return {
    paragraphs,
    citations,
    links,
    briefingMarkdown,
    handoff: null,
  };
}
