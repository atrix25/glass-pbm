/**
 * Deterministic intent routing for the member service agent.
 *
 * A language model is a good router and a terrible calculator. This module is
 * the router in the no-key case, and in both cases it is what the answer is
 * built out of: a plan is a list of tool calls, and the composed answer only
 * ever restates values that came back from those calls.
 *
 * The important property is not that this is clever. It is that a demo run
 * without an API key produces exactly the same numbers as a run with one,
 * because neither path is allowed to compute anything.
 */

import { prisma } from "@/lib/db";
import { TOOL_REGISTRY, type ToolName } from "./tools";

export interface PlannedCall {
  tool: ToolName;
  args: Record<string, unknown>;
  /** Why the agent decided to make this call, shown in the work panel. */
  because: string;
}

const DRUG_HINTS = [
  "SKYRIZI",
  "DUPIXENT",
  "HUMIRA",
  "ADALIMUMAB",
  "ELIQUIS",
  "JARDIANCE",
  "OZEMPIC",
  "TRULICITY",
  "LIPITOR",
  "ATORVASTATIN",
  "METFORMIN",
  "LISINOPRIL",
  "LEVOTHYROXINE",
  "AMLODIPINE",
  "OMEPRAZOLE",
  "SERTRALINE",
  "GABAPENTIN",
  "MOUNJARO",
  "ENBREL",
  "STELARA",
  "TALTZ",
  "COSENTYX",
  "XELJANZ",
  "RINVOQ",
  "TREMFYA",
  "OTEZLA",
  "REVLIMID",
  "IMBRUVICA",
  "BIKTARVY",
  "TRIKAFTA",
];

export interface DrugMention {
  /** A product the formulary actually contains. */
  drug: string | null;
  /**
   * A word that looked like a drug name but matched nothing. This is a
   * different situation from no drug being named, and it deserves a different
   * answer: telling someone "you are covered under the IYC plan" when they
   * asked about a product the agent could not identify reads as though the
   * question was understood.
   */
  unrecognised: string | null;
}

/**
 * Pull a drug name out of free text, preferring names the member actually has.
 *
 * `claimedPhrases` are spans of the question that an intent pattern already
 * matched. A word inside one of those is part of an English phrase the router
 * recognised, not a product: "out of pocket maximum" must not yield a drug
 * called Pocket.
 */
export async function extractDrug(
  text: string,
  memberId: string,
  claimedPhrases: string[] = [],
): Promise<DrugMention> {
  const upper = text.toUpperCase();

  const memberDrugs = await prisma.claim.findMany({
    where: { memberId },
    select: { drug: { select: { name: true } } },
    distinct: ["drugId"],
    take: 200,
  });
  for (const row of memberDrugs) {
    const first = row.drug.name.split(/[\s(]/)[0];
    if (first.length >= 5 && upper.includes(first)) {
      return { drug: first, unrecognised: null };
    }
  }

  for (const hint of DRUG_HINTS) {
    if (upper.includes(hint)) return { drug: hint, unrecognised: null };
  }

  // Last resort: a capitalised-looking word after "my"/"the". Only accept it
  // if it actually names a product on the formulary. Without that check,
  // "why was my CLAIM rejected" searches the drug table for "CLAIM" and the
  // agent then reports that the member has no claims.
  const m = upper.match(
    /\b(?:MY|THE|FOR|OF|ON|IS|ABOUT|THAN|COVER|COVERED)\s+([A-Z]{5,})\b/,
  );
  const claimed = claimedPhrases.some((p) => p.toUpperCase().includes(m?.[1] ?? "\u0000"));
  if (m && !STOPWORDS.has(m[1]) && !claimed) {
    const exists = await prisma.drug.findFirst({
      where: { name: { startsWith: m[1] } },
      select: { id: true },
    });
    if (exists) return { drug: m[1], unrecognised: null };
    return { drug: null, unrecognised: titleCase(m[1]) };
  }
  return { drug: null, unrecognised: null };
}

function titleCase(word: string): string {
  return word.charAt(0) + word.slice(1).toLowerCase();
}

/*
 * Ordinary English words that sit where a drug name would. "Was my prior
 * authorization approved" puts PRIOR immediately after MY, and treating that
 * as an unrecognised product hijacks the question.
 */
const STOPWORDS = new Set([
  "PRESCRIPTION",
  "PRESCRIPTIONS",
  "MEDICATION",
  "MEDICATIONS",
  "PHARMACY",
  "PHARMACIST",
  "DOCTOR",
  "CLAIM",
  "CLAIMS",
  "PLAN",
  "LIMIT",
  "LIMITS",
  "REFILL",
  "REFILLS",
  "COVERAGE",
  "COVERED",
  "DEDUCTIBLE",
  "SPECIALTY",
  "AUTHORIZATION",
  "AUTHORIZATIONS",
  "PRIOR",
  "COUNTER",
  "MONEY",
  "MEDICINE",
  "MEDICINES",
  "BENEFIT",
  "BENEFITS",
  "FORMULARY",
  "ANYTHING",
  "SOMETHING",
  "OTHERS",
  "PROVIDER",
  "INSURANCE",
  "PAYMENT",
  "PAYMENTS",
  "BALANCE",
  "STATEMENT",
  "ACCOUNT",
  "DOSAGE",
  "AMOUNT",
  "TOTAL",
  "MONTH",
  "MONTHS",
  "TREATMENT",
  "THERAPY",
  "CONDITION",
  "OPTION",
  "OPTIONS",
  "CHEAPER",
  "GENERIC",
  "GENERICS",
  // Function words and other closed-class English that can land in the slot a
  // drug name would occupy: "is THERE anything cheaper", "of POCKET maximum".
  "THERE",
  "THESE",
  "THOSE",
  "WHICH",
  "WHERE",
  "WHILE",
  "WOULD",
  "COULD",
  "SHOULD",
  "BEING",
  "THEIR",
  "OTHER",
  "EVERY",
  "AFTER",
  "BEFORE",
  "STILL",
  "ABOUT",
  "AGAIN",
  "GOING",
  "RIGHT",
  "POCKET",
  "MAXIMUM",
  "EXPENSIVE",
  "SUPPLY",
  "NETWORK",
  "SPENDING",
  "REASON",
  "PROBLEM",
  "ANOTHER",
  "REFILLED",
  "APPROVED",
  "DENIED",
]);

interface Intent {
  id: string;
  /** All of these must appear for the intent to match. */
  all?: RegExp[];
  /** Any one of these is enough. */
  any: RegExp[];
  weight: number;
  build: (ctx: {
    memberId: string;
    drug: string | null;
    text: string;
  }) => PlannedCall[];
}

const INTENTS: Intent[] = [
  {
    id: "oop-limit",
    any: [
      /out.?of.?pocket/i,
      /\$?600/,
      /\bmy limit\b/i,
      /\bmax(imum)?\b.*\bpay/i,
      /still (paying|being charged)/i,
      /hit (my|the) (limit|cap|max)/i,
      /how much have i (paid|spent)/i,
      /deductible/i,
    ],
    weight: 3,
    build: ({ memberId }) => [
      {
        tool: "getAccumulators",
        args: { memberId },
        because:
          "The question is about how much the member has paid and what counted toward the limit.",
      },
      {
        tool: "getClaims",
        args: { memberId, limit: 40 },
        because:
          "Needed to identify which fills produced cost share that did not accumulate.",
      },
    ],
  },
  {
    id: "pa-status",
    any: [
      /prior auth/i,
      /\bpa\b/i,
      /approv(ed|al)/i,
      /\bdenied\b/i,
      /denial/i,
      /why.*(not covered|rejected).*(need|require)/i,
    ],
    weight: 4,
    build: ({ memberId, drug }) => {
      const calls: PlannedCall[] = [
        {
          tool: "getPriorAuthStatus",
          args: { memberId, ...(drug ? { drugName: drug } : {}) },
          because:
            "The question is about a prior authorization, so read the request record and the step that decided it.",
        },
      ];
      if (drug) {
        calls.push({
          tool: "explainCriteria",
          args: { drugName: drug },
          because:
            "Quote the published criteria document so the decision can be checked against the form.",
        });
      }
      return calls;
    },
  },
  {
    id: "refill",
    any: [
      /refill/i,
      /too soon/i,
      /pick (it |them )?up/i,
      /when can i/i,
      /run(ning)? out/i,
    ],
    weight: 4,
    build: ({ memberId, drug }) => [
      {
        tool: "refillEligibility",
        args: { memberId, ...(drug ? { drugName: drug } : {}) },
        because: drug
          ? "Compute the earliest refill date from the last paid fill and the plan's 75% threshold."
          : "No drug was named, so find the fill that was actually rejected for refill too soon and date it from there.",
      },
    ],
  },
  {
    id: "cost-quote",
    any: [
      /how much (will|would|does|do|is|are|am i)/i,
      /what.{0,12}(cost|price)/i,
      /cost me/i,
      /pay for/i,
      /copay/i,
      /coinsurance/i,
      /price of/i,
    ],
    weight: 3,
    build: ({ memberId, drug }) =>
      drug
        ? [
            {
              tool: "checkCoverage",
              args: { drugName: drug, memberId },
              because: "Establish the benefit level and any restrictions first.",
            },
            {
              tool: "estimateCost",
              args: { memberId, drugName: drug },
              because:
                "Price the fill by running the real adjudication engine rather than estimating.",
            },
          ]
        : [
            {
              tool: "getAccumulators",
              args: { memberId },
              because:
                "No drug was named, so answer with the member's current cost share position.",
            },
          ],
  },
  {
    id: "coverage",
    any: [
      /covered/i,
      /cover /i,
      /formulary/i,
      /\btier\b/i,
      /\blevel\b/i,
      /on my plan/i,
    ],
    weight: 2,
    build: ({ memberId, drug }) =>
      drug
        ? [
            {
              tool: "checkCoverage",
              args: { drugName: drug, memberId },
              because: "Read the formulary entry for the named drug.",
            },
          ]
        : [
            {
              tool: "getMemberProfile",
              args: { memberId },
              because: "No drug named, so start from the member's plan.",
            },
          ],
  },
  {
    id: "cheaper",
    any: [
      /cheaper/i,
      /less expensive/i,
      /lower cost/i,
      /alternative/i,
      /generic/i,
      /save money/i,
    ],
    weight: 4,
    build: ({ memberId, drug }) =>
      drug
        ? [
            {
              tool: "checkCoverage",
              args: { drugName: drug, memberId },
              because: "Establish what level the current drug sits at.",
            },
            {
              tool: "findAlternatives",
              args: { drugName: drug, memberId },
              because:
                "Look for same-class products at a lower benefit level.",
            },
          ]
        : [
            {
              tool: "getClaims",
              args: { memberId, limit: 20 },
              because:
                "Find the member's most expensive fills before suggesting anything.",
            },
          ],
  },
  {
    id: "claim-question",
    any: [
      /charged/i,
      /why did i pay/i,
      /last (fill|claim|prescription)/i,
      /receipt/i,
      /rejected/i,
      /reject/i,
      /wouldn.?t (go through|process)/i,
      /didn.?t work/i,
    ],
    weight: 2,
    build: ({ memberId, drug }) => [
      {
        tool: "getClaims",
        args: { memberId, limit: 12, ...(drug ? { drugName: drug } : {}) },
        because: "Locate the claim the member is asking about.",
      },
    ],
  },
  {
    id: "pharmacy",
    any: [/pharmac(y|ies)/i, /where can i fill/i, /mail order/i, /lumicera/i],
    weight: 3,
    build: ({ text }) => [
      {
        tool: "findPharmacies",
        args: { specialtyOnly: /specialty|lumicera/i.test(text) },
        because: "List pharmacies that are in the contracted network.",
      },
    ],
  },
];

export interface Plan {
  /** Which narrative the composer should write. Never inferred from tools. */
  intent: string;
  drug: string | null;
  /** Set when the question named something the formulary does not contain. */
  unrecognisedDrug: string | null;
  calls: PlannedCall[];
}

export async function planCalls(
  question: string,
  memberId: string,
): Promise<Plan> {
  // Score intents first. Scoring does not depend on the drug, and the spans
  // the patterns matched are what tells the extractor which words are already
  // spoken for as ordinary English.
  const scored = INTENTS.map((intent) => {
    const matches = intent.any
      .map((r) => question.match(r)?.[0])
      .filter((s): s is string => Boolean(s));
    return { intent, score: matches.length * intent.weight, matches };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const claimedPhrases = scored.flatMap((s) => s.matches);
  const mention = await extractDrug(question, memberId, claimedPhrases);
  const drug = mention.drug;

  // A named product that resolves to nothing is answerable on its own, and
  // running the general tools would bury that behind unrelated plan detail.
  if (mention.unrecognised) {
    return {
      intent: "unknown-drug",
      drug: null,
      unrecognisedDrug: mention.unrecognised,
      calls: [
        {
          tool: "checkCoverage",
          args: { drugName: mention.unrecognised, memberId },
          because: `The question named "${mention.unrecognised}", which is not a product on this formulary. Confirm against the drug file before saying so.`,
        },
      ],
    };
  }

  if (scored.length === 0) {
    return {
      intent: "unknown",
      drug,
      unrecognisedDrug: null,
      calls: [
        {
          tool: "getMemberProfile",
          args: { memberId },
          because:
            "The question did not match a known intent, so start from the member record.",
        },
        {
          tool: "getAccumulators",
          args: { memberId },
          because: "Cost share position is relevant to most member questions.",
        },
        {
          tool: "getClaims",
          args: { memberId, limit: 8 },
          because: "Recent activity is the usual context for a vague question.",
        },
      ],
    };
  }

  // Take the top intent, and fold in a second one if it scored nearly as well.
  const calls = scored[0].intent.build({ memberId, drug, text: question });
  if (scored[1] && scored[1].score >= scored[0].score * 0.75) {
    for (const c of scored[1].intent.build({ memberId, drug, text: question })) {
      if (!calls.some((x) => x.tool === c.tool)) calls.push(c);
    }
  }
  return {
    intent: scored[0].intent.id,
    drug,
    unrecognisedDrug: null,
    calls: calls.slice(0, 4),
  };
}

export async function runPlan(plan: PlannedCall[]) {
  const results = [];
  for (const call of plan) {
    const def = TOOL_REGISTRY[call.tool];
    const parsed = def.schema.safeParse(call.args);
    if (!parsed.success) {
      results.push({
        tool: call.tool,
        args: call.args,
        because: call.because,
        error: parsed.error.issues.map((i) => i.message).join("; "),
        result: null,
      });
      continue;
    }
    // The registry is a union of narrow signatures; the schema check above is
    // what actually guarantees the shape.
    const exec = def.execute as (a: unknown) => Promise<unknown>;
    const result = await exec(parsed.data);
    results.push({
      tool: call.tool,
      args: parsed.data,
      because: call.because,
      error: null,
      result,
    });
  }
  return results;
}
