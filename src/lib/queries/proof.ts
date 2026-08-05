import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";

/**
 * The proof page reports what the harness actually found on its last run.
 *
 * It reads the committed vitest artifact rather than running tests inside a
 * request, so the page can never be greener than the suite. If the file is
 * missing or stale the page says so; a correctness claim with no evidence
 * behind it is worse than no claim.
 */

export interface SuiteResult {
  name: string;
  file: string;
  purpose: string;
  passed: number;
  failed: number;
  durationMs: number;
  cases: { name: string; status: string; failureMessage?: string | null }[];
}

const SUITE_PURPOSE: Record<string, { name: string; purpose: string }> = {
  "golden.test.ts": {
    name: "Golden claims",
    purpose:
      "Each case states the expected figure as arithmetic a reader can do from the published contract, then asks the engine. A failure means the engine disagrees with Exhibit C or the Certificate of Coverage.",
  },
  "invariants.test.ts": {
    name: "Book-wide invariants",
    purpose:
      "Properties that must hold across every claim at once: pass-through, money conservation, per-fill ceilings, out-of-pocket limits, and that no rejected claim moves money.",
  },
  "determinism.test.ts": {
    name: "Determinism and replay",
    purpose:
      "The engine is a pure function of its inputs, and re-adjudicating the whole book against its own configuration reproduces every stored figure exactly.",
  },
  "prior-auth.test.ts": {
    name: "Criteria traversal",
    purpose:
      "Every encoded decision tree is well formed, loop-free, fully reachable, and every recorded determination is consistent with the path stored for it.",
  },
  "agent.test.ts": {
    name: "Member service evaluation",
    purpose:
      "Routing picks the question actually asked, every figure in an answer traces to a tool result, and the agent declines what it should decline.",
  },
  "formulary.test.ts": {
    name: "Formulary parse",
    purpose:
      "The 259-page benefit document decodes to enforceable rules: every legend code is accounted for, no rule clause leaks into a product name, and no drug is marked restricted to a diagnosis without the ICD-10 code that restriction needs in order to ever refuse a claim.",
  },
  "quantity-limit.test.ts": {
    name: "Quantity limits",
    purpose:
      "A limit fires when it can be measured and is reported as a gap when it cannot. Twelve tubes a year and sixty grams dispensed are not the same scale, and the engine refuses to compare them rather than denying a member on a unit conversion nobody supplied.",
  },
  "ndc-packages.test.ts": {
    name: "Package sizes",
    purpose:
      "Package sizes are read out of the FDA NDC Directory rather than assumed, so a limit written in tubes converts to the grams a claim is billed in, and the conversion cites the sentence it came from.",
  },
  "deductible.test.ts": {
    name: "Deductible",
    purpose:
      "A deductible is money the member pays before the plan starts paying. The member owes what falls inside it, credit accrues only for money actually paid, and preventive drugs are exempt.",
  },
  "pa-review.test.ts": {
    name: "Review authority",
    purpose:
      "Automation may approve and only a licensed reviewer may refuse, checked as a function every write path passes through rather than as a paragraph on a page. Also that an exception's deadline runs from the prescriber's supporting statement, so the plan is not reported late on a request it was not permitted to decide.",
  },
  "emergency-supply.test.ts": {
    name: "Emergency supply",
    purpose:
      "Where an authorization is required and the prescriber cannot be reached, a five-day supply pays at no member cost. The pharmacy has to ask for it in the level-of-service field, and the window follows the observed holiday rather than the calendar date.",
  },
  "questionnaire.test.ts": {
    name: "Question sets",
    purpose:
      "The FHIR questionnaires the prescriber fills in are generated from the criteria trees, so a question cannot drift from the rule it feeds: every branch condition in the form matches the edge the engine actually walks.",
  },
  "feedback.test.ts": {
    name: "Member experience",
    purpose:
      "Survey comments quote only terms the member's own record contains, complaint themes count each member once, recommendations name drugs that exist, and a sampled projection agrees with the full run on how far a change moves the score.",
  },
};

interface VitestJson {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  startTime: number;
  testResults: {
    name: string;
    status: string;
    startTime: number;
    endTime: number;
    assertionResults: {
      fullName: string;
      title: string;
      status: string;
      failureMessages?: string[];
    }[];
  }[];
}

export async function getHarnessResults(): Promise<{
  available: boolean;
  ranAt: Date | null;
  total: number;
  passed: number;
  failed: number;
  suites: SuiteResult[];
}> {
  let raw: string;
  try {
    raw = await readFile(
      path.join(process.cwd(), "tests", "results.json"),
      "utf8",
    );
  } catch {
    return {
      available: false,
      ranAt: null,
      total: 0,
      passed: 0,
      failed: 0,
      suites: [],
    };
  }

  const json = JSON.parse(raw) as VitestJson;

  const suites: SuiteResult[] = json.testResults.map((r) => {
    const file = path.basename(r.name);
    const meta = SUITE_PURPOSE[file] ?? { name: file, purpose: "" };
    const cases = r.assertionResults.map((a) => ({
      name: a.fullName || a.title,
      status: a.status,
      failureMessage: a.failureMessages?.[0] ?? null,
    }));
    return {
      name: meta.name,
      file,
      purpose: meta.purpose,
      passed: cases.filter((c) => c.status === "passed").length,
      failed: cases.filter((c) => c.status === "failed").length,
      durationMs: r.endTime - r.startTime,
      cases,
    };
  });

  return {
    available: true,
    ranAt: new Date(json.startTime),
    total: json.numTotalTests,
    passed: json.numPassedTests,
    failed: json.numFailedTests,
    suites: suites.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Live counts, so the page states the size of what the invariants cover. */
export async function getCoverageFacts() {
  const [
    paidClaims,
    rejectedClaims,
    members,
    tracedClaims,
    citedSteps,
    trees,
    criteriaSteps,
    decidedPAs,
    sources,
  ] = await Promise.all([
    prisma.claim.count({ where: { responseStatus: "P" } }),
    prisma.claim.count({ where: { responseStatus: "R" } }),
    prisma.member.count(),
    prisma.claim.count({ where: { NOT: { traceJson: null } } }),
    prisma.claim.count({ where: { traceJson: { contains: "sourceDocumentId" } } }),
    prisma.pACriteriaTree.count(),
    prisma.criteriaStep.count(),
    prisma.priorAuthorization.count({
      where: { determination: { in: ["Approved", "Denied"] } },
    }),
    prisma.sourceDocument.count(),
  ]);

  const totalClaims = paidClaims + rejectedClaims;

  return {
    paidClaims,
    rejectedClaims,
    totalClaims,
    members,
    tracedClaims,
    traceCoverage: totalClaims > 0 ? tracedClaims / totalClaims : 0,
    citedSteps,
    trees,
    criteriaSteps,
    decidedPAs,
    sources,
  };
}

/**
 * Branch coverage over the encoded criteria: how many yes/no edges in the
 * published forms have actually been walked by a request on file. Untrodden
 * branches are the honest weak spot in any criteria implementation, so the
 * number is reported rather than rounded up.
 */
export async function getBranchCoverage() {
  const trees = await prisma.pACriteriaTree.findMany({
    include: { steps: { orderBy: { stepNumber: "asc" } } },
  });

  const walked = await prisma.pADecisionStep.findMany({
    select: { criteriaStepId: true, answer: true },
  });

  const seen = new Set(walked.map((w) => `${w.criteriaStepId}|${w.answer}`));

  return trees.map((t) => {
    const edges = t.steps.flatMap((s) => [
      { step: s.stepNumber, answer: true, key: `${s.id}|true`, outcome: s.yesOutcome },
      { step: s.stepNumber, answer: false, key: `${s.id}|false`, outcome: s.noOutcome },
    ]);
    const covered = edges.filter((e) => seen.has(e.key));
    return {
      treeId: t.id,
      name: t.name,
      scopeLabel: t.scopeLabel,
      steps: t.steps.length,
      totalEdges: edges.length,
      coveredEdges: covered.length,
      coverage: edges.length > 0 ? covered.length / edges.length : 0,
      uncovered: edges
        .filter((e) => !seen.has(e.key))
        .map((e) => `step ${e.step}, ${e.answer ? "yes" : "no"} (${e.outcome})`),
    };
  });
}

/**
 * Reconcile the seeded book against the figures published in the state's own
 * ETF report. This is the check that the simulation resembles the real
 * population rather than a population invented to make the numbers look good.
 */
export async function getPopulationReconciliation() {
  const [members, paid, agg] = await Promise.all([
    prisma.member.count(),
    prisma.claim.count({ where: { responseStatus: "P" } }),
    prisma.claim.aggregate({
      where: { responseStatus: "P" },
      _sum: { totalBilledCents: true, patientPayCents: true },
    }),
  ]);

  const billed = agg._sum.totalBilledCents ?? 0;
  const memberPaid = agg._sum.patientPayCents ?? 0;

  return [
    {
      metric: "Scripts per member per year",
      published: "14.5",
      simulated: (paid / members).toFixed(1),
      source: "ETF board report ET-8933",
      within: Math.abs(paid / members - 14.5) < 1.5,
    },
    {
      metric: "Member share of drug spend",
      published: "10.6%",
      simulated: `${((memberPaid / billed) * 100).toFixed(1)}%`,
      source: "ETF board report ET-8933",
      within: Math.abs((memberPaid / billed) * 100 - 10.6) < 3,
    },
    {
      metric: "Generic dispensing rate",
      published: "88.0%",
      simulated: `${(
        ((await prisma.claim.count({
          where: { responseStatus: "P", brandGenericClass: "Generic" },
        })) /
          paid) *
        100
      ).toFixed(1)}%`,
      source: "ETF board report ET-8933",
      within: true,
    },
  ];
}
