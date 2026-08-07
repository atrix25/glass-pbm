/**
 * Deterministic intent routing for the data agent.
 *
 * Same design as member-service planning: a regex router that produces a list
 * of tool calls. When ANTHROPIC_API_KEY is set the agent may ask the brain to
 * choose an intent, but the fallback here always produces the same shape, and
 * every figure still comes from a tool.
 */

import { z } from "zod";
import { judge } from "@/lib/agents/brain";
import type { DataToolName } from "./data-tools";

export type DataIntent =
  | "book-totals"
  | "guarantees"
  | "rebates"
  | "spread"
  | "awp"
  | "trends"
  | "top-spend"
  | "settlement"
  | "scorecard"
  | "claim-lookup"
  | "claim-detail"
  | "full-report"
  | "unknown";

export interface DataPlannedCall {
  tool: DataToolName;
  args: Record<string, unknown>;
  because: string;
}

export interface DataPlan {
  intent: DataIntent;
  calls: DataPlannedCall[];
  claimRef: string | null;
}

const INTENT_SCHEMA = z.object({
  intent: z.enum([
    "book-totals",
    "guarantees",
    "rebates",
    "spread",
    "awp",
    "trends",
    "top-spend",
    "settlement",
    "scorecard",
    "claim-lookup",
    "claim-detail",
    "full-report",
    "unknown",
  ]),
  claimRef: z.string().nullable(),
  sections: z
    .array(z.enum(["guarantees", "rebates", "spread", "awp"]))
    .optional(),
  briefingKind: z
    .enum([
      "guarantees",
      "rebates",
      "spread",
      "awp",
      "full-year",
      "trends",
      "settlement",
    ])
    .optional(),
});

type IntentJudgement = z.infer<typeof INTENT_SCHEMA>;

function scoreIntent(question: string): DataIntent {
  const q = question.toLowerCase();

  if (
    /\b(full[- ]?year|year[- ]?end|annual)\b.*\b(report|briefing)\b/.test(q) ||
    /\b(write|compose|generate|draft)\b.*\b(full|complete|year)\b.*\b(report|briefing)\b/.test(
      q,
    ) ||
    /\breport briefing\b/.test(q)
  ) {
    return "full-report";
  }
  if (
    /\b(guarantee|guarantees|exhibit c|discount)\b/.test(q) &&
    /\b(miss|met|reconcil|pricing|short)\b/.test(q)
  ) {
    return "guarantees";
  }
  if (/\b(guarantee|guarantees|exhibit c)\b/.test(q)) return "guarantees";
  if (/\b(rebate|rebates|waterfall)\b/.test(q)) return "rebates";
  if (/\b(spread|traditional|michigan|optum)\b/.test(q)) return "spread";
  if (/\b(awp|sensitivity)\b/.test(q)) return "awp";
  if (
    /\b(trend|pmpm|driver|drivers|utilisation|utilization|mix)\b/.test(q)
  ) {
    return "trends";
  }
  if (
    /\b(top|highest|biggest)\b.*\b(drug|drugs|class|spend|cost)\b/.test(q) ||
    /\b(drug|class)\b.*\b(spend|cost)\b/.test(q)
  ) {
    return "top-spend";
  }
  if (
    /\b(settlement|invoice|remittance|receivable|pharmacy paid)\b/.test(q)
  ) {
    return "settlement";
  }
  if (
    /\b(scorecard|sla|service credit|operational guarantee|incident)\b/.test(q)
  ) {
    return "scorecard";
  }
  if (
    /\b(claim|claims)\b/.test(q) &&
    /\b(number|detail|look ?up|find|show|open)\b/.test(q)
  ) {
    return "claim-detail";
  }
  if (/\b(claim|claims|reject|ledger)\b/.test(q)) return "claim-lookup";
  if (
    /\b(book|totals?|spend|plan cost|how much|dashboard|pmpm)\b/.test(q) ||
    /\b(members?|paid claims)\b/.test(q)
  ) {
    return "book-totals";
  }
  if (/\b(report|briefing|compose|generate|write)\b/.test(q)) {
    return "full-report";
  }
  return "unknown";
}

function extractClaimRef(question: string): string | null {
  const m =
    question.match(/\b(CLM[- ]?\d[\w-]*)\b/i) ??
    question.match(/\bclaim\s+(?:number\s+)?([A-Z0-9-]{6,})\b/i);
  return m?.[1] ?? null;
}

function callsFor(
  intent: DataIntent,
  claimRef: string | null,
  judgement?: IntentJudgement,
): DataPlannedCall[] {
  switch (intent) {
    case "book-totals":
      return [
        {
          tool: "getBookSnapshot",
          args: {},
          because:
            "The question is about book-level spend and membership, which the sponsor rollup answers.",
        },
      ];
    case "guarantees":
      return [
        {
          tool: "getContractReports",
          args: { sections: ["guarantees"] },
          because:
            "Pricing guarantees are reconciled from Exhibit C against the claim ledger.",
        },
        {
          tool: "composeReportBriefing",
          args: { kind: "guarantees" },
          because: "Compose a briefing that matches the Reports page card.",
        },
      ];
    case "rebates":
      return [
        {
          tool: "getContractReports",
          args: { sections: ["rebates"] },
          because: "Rebate waterfall is computed from brand claims and floors.",
        },
        {
          tool: "composeReportBriefing",
          args: { kind: "rebates" },
          because: "Compose the rebate briefing from those figures.",
        },
      ];
    case "spread":
      return [
        {
          tool: "getContractReports",
          args: { sections: ["spread"] },
          because:
            "The spread counterfactual applies a published traditional schedule to this book.",
        },
        {
          tool: "composeReportBriefing",
          args: { kind: "spread" },
          because: "Compose the spread comparison briefing.",
        },
      ];
    case "awp":
      return [
        {
          tool: "getContractReports",
          args: { sections: ["awp"] },
          because: "AWP sensitivity is measured from the pricing-arm mix.",
        },
        {
          tool: "composeReportBriefing",
          args: { kind: "awp" },
          because: "Compose the AWP exposure briefing.",
        },
      ];
    case "trends":
      return [
        {
          tool: "getTrendDrivers",
          args: {},
          because:
            "PMPM movement is explained by the trend bridge and ranked drivers.",
        },
        {
          tool: "composeReportBriefing",
          args: { kind: "trends" },
          because: "Compose a trend briefing from the bridge.",
        },
      ];
    case "top-spend":
      return [
        {
          tool: "getTopSpend",
          args: { by: "both", limit: 10 },
          because: "Top drugs and classes come from the daily drug/class rollup.",
        },
      ];
    case "settlement":
      return [
        {
          tool: "getSettlementSnapshot",
          args: {},
          because:
            "Settlement questions are answered from remittance, invoices, and rebate receivables.",
        },
        {
          tool: "composeReportBriefing",
          args: { kind: "settlement" },
          because: "Compose a settlement briefing from those snapshots.",
        },
      ];
    case "scorecard":
      return [
        {
          tool: "getGuaranteeScorecard",
          args: {},
          because:
            "Operational guarantees and service credits live on the reconciliation scorecard.",
        },
      ];
    case "claim-detail":
      if (claimRef) {
        return [
          {
            tool: "getClaimDetail",
            args: { idOrNumber: claimRef },
            because: `Look up claim ${claimRef} for a full derivation.`,
          },
        ];
      }
      return [
        {
          tool: "lookupClaims",
          args: { page: 1 },
          because:
            "No claim number was named; show a recent page of the ledger instead.",
        },
      ];
    case "claim-lookup":
      return [
        {
          tool: "lookupClaims",
          args: { page: 1 },
          because: "Search the claim ledger for matching rows.",
        },
      ];
    case "full-report":
      return [
        {
          tool: "getBookSnapshot",
          args: {},
          because: "Anchor the briefing on current book totals.",
        },
        {
          tool: "getContractReports",
          args: {
            sections: judgement?.sections ?? [
              "guarantees",
              "rebates",
              "spread",
              "awp",
            ],
          },
          because: "Pull all four contract report sections.",
        },
        {
          tool: "composeReportBriefing",
          args: { kind: judgement?.briefingKind ?? "full-year" },
          because: "Compose a year-to-date briefing that mirrors the Reports page.",
        },
      ];
    case "unknown":
    default:
      return [
        {
          tool: "getBookSnapshot",
          args: {},
          because:
            "Intent was unclear; start with the book snapshot a sponsor would open first.",
        },
      ];
  }
}

function planFromJudgement(j: IntentJudgement, question: string): DataPlan {
  const claimRef = j.claimRef ?? extractClaimRef(question);
  return {
    intent: j.intent,
    claimRef,
    calls: callsFor(j.intent, claimRef, j),
  };
}

function planDeterministic(question: string): DataPlan {
  const intent = scoreIntent(question);
  const claimRef = extractClaimRef(question);
  return {
    intent: claimRef && intent === "unknown" ? "claim-detail" : intent,
    claimRef,
    calls: callsFor(
      claimRef && intent === "unknown" ? "claim-detail" : intent,
      claimRef,
    ),
  };
}

/**
 * Route a sponsor question to tool calls.
 *
 * With a model key, the brain only chooses the intent label. Tool args and
 * numbers still come from the deterministic plan + query layer.
 */
export async function planDataCalls(question: string): Promise<DataPlan> {
  const fallback = (): IntentJudgement => {
    const p = planDeterministic(question);
    const briefingKind:
      | IntentJudgement["briefingKind"]
      | undefined =
      p.intent === "full-report"
        ? "full-year"
        : p.intent === "guarantees" ||
            p.intent === "rebates" ||
            p.intent === "spread" ||
            p.intent === "awp" ||
            p.intent === "trends" ||
            p.intent === "settlement"
          ? p.intent
          : undefined;
    return {
      intent: p.intent,
      claimRef: p.claimRef,
      sections:
        p.intent === "full-report"
          ? ["guarantees", "rebates", "spread", "awp"]
          : undefined,
      briefingKind,
    };
  };

  const thought = await judge({
    system: `You route plan-sponsor analytics questions for Glass, a transparent PBM.
Choose exactly one intent. Do not invent numbers. claimRef is only a claim id/number if the user named one.
Intents: book-totals, guarantees, rebates, spread, awp, trends, top-spend, settlement, scorecard, claim-lookup, claim-detail, full-report, unknown.
Use full-report when they ask to write/generate/compose a report or briefing.`,
    prompt: question,
    schema: INTENT_SCHEMA,
    fallback,
  });

  return planFromJudgement(thought.value, question);
}
