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
  | "prior-auth"
  | "mac"
  | "member-experience"
  | "integrity"
  | "claim-rejects"
  | "clinical"
  | "eligibility"
  | "claim-lookup"
  | "claim-detail"
  | "formulary-um"
  | "formulary-search"
  | "full-report"
  | "unknown";

export interface DataPlannedCall {
  tool: DataToolName;
  args: Record<string, unknown>;
  because: string;
}

export interface DataPlan {
  brain?: "model" | "deterministic";
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
    "prior-auth",
    "mac",
    "member-experience",
    "integrity",
    "claim-rejects",
    "clinical",
    "eligibility",
    "claim-lookup",
    "claim-detail",
    "formulary-um",
    "formulary-search",
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
  formularyFlag: z.enum(["step", "pa", "ql", "specialty", "any"]).optional(),
  drugQuery: z.string().nullable().optional(),
});

type IntentJudgement = z.infer<typeof INTENT_SCHEMA>;

function sanitizeDrugQuery(q: string | null | undefined): string | undefined {
  if (!q?.trim()) return undefined;
  const trimmed = q.trim();
  const lower = trimmed.toLowerCase();
  const blocked = [
    "formulary",
    "the formulary",
    "our formulary",
    "book",
    "plan",
    "drug list",
    "the book",
    "our book",
  ];
  if (blocked.includes(lower) || /^(the|our|this|a|an)\s+(formulary|book|plan)\b/.test(lower)) {
    return undefined;
  }
  return trimmed;
}

function extractDrugQuery(question: string): string | null {
  const m = question.match(
    /\b(?:drug|medication|product)\s+([A-Za-z][A-Za-z0-9 -]{2,40})\b/i,
  );
  return sanitizeDrugQuery(m?.[1] ?? null) ?? null;
}

function wantsFormularyCatalog(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /\b(all|list|how many|count|which drugs|what drugs)\b/.test(q) ||
    /\bformulary\b.*\b(step|st\b|pa\b|prior auth|quantity limit|ql\b)/.test(q) ||
    /\b(step therapy|prior auth|quantity limit)\b.*\bdrugs?\b/.test(q)
  );
}

function inferFormularyFlag(question: string): IntentJudgement["formularyFlag"] {
  const q = question.toLowerCase();
  if (/\bstep[- ]?therapy|\bst\b/.test(q)) return "step";
  if (/\bprior auth|\bpa\b|\bpriorit/.test(q)) return "pa";
  if (/\bquantity limit|\bql\b/.test(q)) return "ql";
  if (/\bspecialty pharmacy|\bmandatory specialty\b/.test(q)) return "specialty";
  return "any";
}

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
    /\b(prior auth|prior authorization|\bpa queue|\bpa turnaround|authorization queue|expedited pa)\b/.test(
      q,
    )
  ) {
    return "prior-auth";
  }
  if (
    /\b(mac|maximum allowable cost|mac appeal|ceiling price|632\.865)\b/.test(q)
  ) {
    return "mac";
  }
  if (
    /\b(nps|net promoter|member experience|member satisfaction|detractor|promoter)\b/.test(
      q,
    )
  ) {
    return "member-experience";
  }
  if (
    /\b(integrity|fwa|fraud|waste|abuse|program integrity|opioid shopping|signal)\b/.test(
      q,
    )
  ) {
    return "integrity";
  }
  if (
    /\b(clinical alert|drug interaction|opioid|mme|duplication|therapeutic overlap)\b/.test(
      q,
    )
  ) {
    return "clinical";
  }
  if (
    /\b(eligibility feed|834|enrollment file|eligibility reject|lives on file|member file)\b/.test(
      q,
    )
  ) {
    return "eligibility";
  }
  if (
    /\b(reject code|reject mix|claim reject|rejected claim|denied claim)\b/.test(
      q,
    ) &&
    !/\beligibility\b/.test(q)
  ) {
    return "claim-rejects";
  }
  if (wantsFormularyCatalog(question)) {
    return "formulary-search";
  }
  if (
    /\b(step therapy|step-therapy|step therap|priorit|prior auth|prior authorization|utilization management|\bum rules?\b|special code|formulary management)\b/.test(
      q,
    ) &&
    /\b(high cost|high-cost|expensive|top drug|specialty|level [34]|costly)\b/.test(
      q,
    )
  ) {
    return "formulary-um";
  }
  if (
    /\b(step therapy|priorit|what.*(pa|prior auth|um).*exist|formulary.*(flag|rule|requirement))\b/.test(
      q,
    )
  ) {
    return "formulary-um";
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
  question?: string,
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
    case "prior-auth":
      return [
        {
          tool: "getPriorAuthOverview",
          args: {},
          because:
            "PA volume, approval mix, and queue depth come from the prior authorization ledger.",
        },
      ];
    case "mac":
      return [
        {
          tool: "getMacOverview",
          args: {},
          because:
            "MAC list coverage and statutory appeal outcomes are measured from the MAC and appeals tables.",
        },
      ];
    case "member-experience":
      return [
        {
          tool: "getMemberExperience",
          args: {},
          because:
            "Census NPS and rubric drivers are computed from the same claim book the member experience page uses.",
        },
      ];
    case "integrity":
      return [
        {
          tool: "getIntegrityOverview",
          args: {},
          because:
            "Program integrity signals and exposure are scored from paid claims.",
        },
      ];
    case "claim-rejects":
      return [
        {
          tool: "getRejectOverview",
          args: {},
          because:
            "Reject code mix is rolled up from adjudicated claim responses.",
        },
      ];
    case "clinical":
      return [
        {
          tool: "getClinicalOverview",
          args: {},
          because:
            "Clinical alerts and opioid MME thresholds are screened across paid claims.",
        },
      ];
    case "eligibility":
      return [
        {
          tool: "getEligibilityOverview",
          args: {},
          because:
            "Eligibility file intake, reject aging, and lives on file come from the 834 feed tables.",
        },
      ];
    case "formulary-search": {
      const flag =
        judgement?.formularyFlag ??
        (question ? inferFormularyFlag(question) : "any");
      const drugQuery = sanitizeDrugQuery(
        judgement?.drugQuery ??
          (question ? extractDrugQuery(question) : null),
      );
      return [
        {
          tool: "searchFormularyUm",
          args: {
            flag,
            ...(drugQuery ? { query: drugQuery } : {}),
            limit: 30,
          },
          because:
            "The published formulary index lists step therapy, PA, and quantity limits by product.",
        },
      ];
    }
    case "formulary-um": {
      const calls: DataPlannedCall[] = [
        {
          tool: "getHighCostDrugUm",
          args: { limit: 15 },
          because:
            "Step therapy and prioritization rules live on the published formulary, joined to YTD spend for the highest-cost products.",
        },
      ];
      if (question && wantsFormularyCatalog(question)) {
        calls.push({
          tool: "searchFormularyUm",
          args: {
            flag: inferFormularyFlag(question),
            limit: 20,
          },
          because:
            "Also search the full formulary index for products carrying the requested UM flag.",
        });
      }
      return calls;
    }
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
    calls: callsFor(j.intent, claimRef, j, question),
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
      {
        intent: claimRef && intent === "unknown" ? "claim-detail" : intent,
        claimRef,
        formularyFlag: inferFormularyFlag(question),
        drugQuery: extractDrugQuery(question),
      },
      question,
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
      formularyFlag: inferFormularyFlag(question),
      drugQuery: extractDrugQuery(question),
    };
  };

  const thought = await judge({
    system: `You route plan-sponsor analytics questions for Glass, a transparent PBM.
Choose exactly one intent. Do not invent numbers. claimRef is only a claim id/number if the user named one.
Intents: book-totals, guarantees, rebates, spread, awp, trends, top-spend, settlement, scorecard, prior-auth, mac, member-experience, integrity, claim-rejects, clinical, eligibility, formulary-um, formulary-search, claim-lookup, claim-detail, full-report, unknown.
Use formulary-um for step therapy / PA / UM on high-cost or top-spend drugs.
Use formulary-search when they ask to list or count all drugs with a UM flag on the formulary.
Use prior-auth for PA queue, turnaround, approval rate. Use mac for MAC ceilings and appeals.
Use member-experience for NPS. Use integrity for FWA signals. Use claim-rejects for adjudication reject codes (not eligibility 834 rejects).
Use eligibility for enrollment feed / 834 file rejects. Use clinical for drug interaction or opioid MME alerts.
Optional formularyFlag (step|pa|ql|specialty|any) and drugQuery when intent is formulary-search.
Use full-report when they ask to write/generate/compose a report or briefing.`,
    prompt: question,
    schema: INTENT_SCHEMA,
    fallback,
  });

  return { ...planFromJudgement(thought.value, question), brain: thought.brain };
}
