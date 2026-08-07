/**
 * What each agent is, what it may do, and who answers for it.
 *
 * An agent without a written scope is not a product feature, it is an
 * unbounded liability, so the scope lives here in a form the runtime can
 * enforce rather than in a slide. Three things in each entry are load-bearing:
 *
 *   `autonomy`      what it may do without a person, as a default that the
 *                   AgentPolicy table can override with an effective date.
 *   `mayNot`        the things it is never allowed to do, in plain words,
 *                   because a scope that cannot be read cannot be audited.
 *   `consequential` the actions that move money or deny care. The runtime
 *                   refuses to auto-apply these at any autonomy level, and the
 *                   invariant suite checks no run ever has.
 */

export type Autonomy = "Propose" | "ActWithReview" | "Act" | "Suspended";

export const AUTONOMY_MEANING: Record<Autonomy, string> = {
  Propose: "Writes a recommendation. A person decides.",
  ActWithReview:
    "Acts, and the action stands unless a person reverses it inside the review window.",
  Act: "Acts on its own. Read-only work, or work with no effect on money or coverage.",
  Suspended: "Switched off. Runs are refused and the queue goes to people.",
};

export interface AgentDef {
  id: string;
  name: string;
  /** One sentence: what job this replaces. */
  purpose: string;
  /** The human function that owns the output. */
  owner: string;
  /** Where its work shows up in the rest of the product. */
  surface: string;
  autonomy: Autonomy;
  /** Tools it is permitted to call. The runtime rejects anything else. */
  tools: string[];
  mayNot: string[];
  /** Action ids that move money or deny care. */
  consequential: string[];
  /**
   * What the incumbent charges to do this with people. Sourced to the same
   * benchmarks the rest of the demo uses, and stated as a range because it is
   * a range.
   */
  incumbent: string;
  /** How this agent is measured, in the same language as the guarantee schedule. */
  measure: { name: string; target: string };
}

export const AGENTS: AgentDef[] = [
  {
    id: "pa-intake",
    name: "Prior authorisation intake",
    purpose:
      "Reads the prescriber's chart note and fills in the criteria answer set, with a quoted line of the note behind every answer.",
    owner: "Clinical operations pharmacist",
    surface: "Prior authorisation queue and each request's detail page",
    autonomy: "ActWithReview",
    tools: ["readNote", "getMemberHistory", "getCriteriaTree", "walkCriteria"],
    mayNot: [
      "Approve or deny a request. It answers the questions; the published criteria tree decides.",
      "Answer a question the note does not support. An unsupported question is left blank and escalated.",
      "Read anything about the member beyond claim history and the request itself.",
    ],
    consequential: ["record-denial"],
    incumbent:
      "$14 to $25 per request in technician time, and a fee per PA on most traditional contracts",
    measure: {
      name: "Extraction accuracy against the pharmacist's answer",
      target: "97% of fields",
    },
  },
  {
    id: "plan-design",
    name: "Plan design",
    purpose:
      "Turns a trend driver into candidate benefit changes and scores each one by re-adjudicating the whole book against it.",
    owner: "Account team, with the plan sponsor deciding",
    surface: "Trend management, and the change console",
    autonomy: "Propose",
    tools: ["getTrendDrivers", "buildOverride", "replay", "countDisruption"],
    mayNot: [
      "Change a benefit. It writes a proposal into the change console and a person commits it.",
      "Report a saving it did not get from a replay of the actual claim book.",
      "Recommend a change whose member disruption it has not counted.",
    ],
    consequential: ["apply-benefit-change"],
    incumbent:
      "A quarterly consulting deliverable, typically $15k to $60k, modelled on a claims extract rather than the live book",
    measure: {
      name: "Modelled saving within tolerance of realised saving",
      target: "±5%",
    },
  },
  {
    id: "integrity-triage",
    name: "Program integrity triage",
    purpose:
      "Takes a scored signal and does the case work: the prescriber set, the fill timeline, the overlap, the alternative explanation, and a recommended action.",
    owner: "Fraud, waste and abuse pharmacist",
    surface: "Program integrity",
    autonomy: "ActWithReview",
    tools: [
      "getSignal",
      "getMemberFills",
      "getPrescriberPattern",
      "getPharmacyPattern",
    ],
    mayNot: [
      "Contact a member, a prescriber or a pharmacy.",
      "Lock a member to a pharmacy, or refer anything to a payer's special investigations unit.",
      "Close a signal as benign without a stated alternative explanation.",
    ],
    consequential: ["refer-to-siu", "lock-in-member"],
    incumbent:
      "45 to 90 minutes of pharmacist case work per signal, and most contracts bill FWA recoveries at 15% to 30% contingency",
    measure: {
      name: "Signals triaged before a pharmacist opens them",
      target: "90%",
    },
  },
  {
    id: "eligibility-resolver",
    name: "Eligibility reject resolution",
    purpose:
      "Reads a rejected 834 transaction, works out what the sponsor's payroll system meant, and proposes the correction.",
    owner: "Eligibility operations",
    surface: "Eligibility feed reject worklist",
    autonomy: "ActWithReview",
    tools: ["getRejectedTransaction", "getMemberContext", "proposeCorrection"],
    mayNot: [
      "Terminate coverage. A correction that ends a member's eligibility goes to a person, whatever it is confident of.",
      "Add a member the file did not name.",
      "Apply a correction it cannot reverse.",
    ],
    consequential: ["terminate-coverage"],
    incumbent:
      "Usually not done at all: rejects sit in a report the sponsor is asked to work, which is why the aging on them runs to weeks",
    measure: {
      name: "Rejects resolved within one business day",
      target: "85%",
    },
  },
  {
    id: "appeal-drafter",
    name: "MAC appeal response",
    purpose:
      "Drafts the statutory response to a pharmacy's MAC appeal, naming a product available at or below the ceiling, or conceding when there is not one.",
    owner: "Network contracting pharmacist",
    surface: "MAC and appeals",
    autonomy: "Propose",
    tools: ["getAppeal", "getWholesalerAvailability", "getMacHistory"],
    mayNot: [
      "Send a response. A pharmacist signs every one.",
      "Uphold a denial without naming a specific NDC and wholesaler, which is what the statute requires.",
      "Change a MAC price.",
    ],
    consequential: ["uphold-denial", "adjust-mac-price"],
    incumbent:
      "The reason appeals take the full statutory 21 days at most PBMs, and the reason some of them are answered with a form letter",
    measure: {
      name: "Draft ready within two business days of the appeal",
      target: "95%",
    },
  },
  {
    id: "member-service",
    name: "Member service",
    purpose:
      "Answers a member's question about coverage, cost and status by calling the same rules engine that adjudicates their claims.",
    owner: "Member services supervisor",
    surface: "AI member service",
    autonomy: "Act",
    tools: [
      "getMemberProfile",
      "getAccumulators",
      "getClaims",
      "explainClaim",
      "checkCoverage",
      "estimateCost",
      "getPriorAuthStatus",
      "explainCriteria",
      "findAlternatives",
      "refillEligibility",
      "findPharmacies",
    ],
    mayNot: [
      "Compute a dollar figure. Every number it says came back from a tool.",
      "Answer a clinical question. Those go to the prescriber, and it says so.",
      "Guess. An unanswerable question becomes a handoff with the context attached.",
    ],
    consequential: [],
    incumbent:
      "$4.50 to $8.00 per member call, and the reason average handle time is a line item in every PBM contract",
    measure: {
      name: "Answered without a handoff",
      target: "80%",
    },
  },
  {
    id: "data-agent",
    name: "Data agent",
    purpose:
      "Answers plan-sponsor data questions and composes report briefings from the claim ledger and contract reports.",
    owner: "Benefits / finance",
    surface: "AI data agent",
    autonomy: "Act",
    tools: [
      "getBookSnapshot",
      "getContractReports",
      "getTrendDrivers",
      "getTopSpend",
      "getSettlementSnapshot",
      "getGuaranteeScorecard",
      "getHighCostDrugUm",
      "searchFormularyUm",
      "getPriorAuthOverview",
      "getMacOverview",
      "getMemberExperience",
      "getIntegrityOverview",
      "getRejectOverview",
      "getClinicalOverview",
      "getEligibilityOverview",
      "lookupClaims",
      "getClaimDetail",
      "composeReportBriefing",
    ],
    mayNot: [
      "Compute a dollar figure. Every number it states came back from a tool that reads the claim ledger.",
      "Change benefits or run a whole-book replay. That is the plan-design agent.",
      "Dump claim-level PHI or export outside an in-chat briefing with deep links.",
      "Invent a report total that is not recomputable from the tools it called.",
    ],
    consequential: [],
    incumbent:
      "Ad-hoc analyst time for sponsor reporting packs, typically hours per question when the PBM workbook and the claim file disagree",
    measure: {
      name: "Figures in the reply backed by a tool result",
      target: "100%",
    },
  },
];

export function agent(id: string): AgentDef {
  const found = AGENTS.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown agent: ${id}`);
  return found;
}

export function isConsequential(agentId: string, action: string): boolean {
  return agent(agentId).consequential.includes(action);
}
