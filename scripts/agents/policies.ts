/**
 * The autonomy each agent has been given, and when it was given.
 *
 * Nothing here started at full autonomy. Each agent ran in propose-only mode
 * against live work until there was enough of a record to argue about, and the
 * level moved when the override rate justified it. The dates matter: a run in
 * February is judged against February's policy, which is why the runtime
 * copies the level onto the run rather than reading it back at display time.
 */

import type { PrismaClient } from "../../src/generated/prisma/index.js";
import { PLAN_YEAR } from "../../src/lib/clock.js";

const d = (month: number, day: number) => new Date(Date.UTC(PLAN_YEAR, month, day));

/**
 * When the agents were switched on, which is before the plan year rather than
 * on the first of January.
 *
 * Prior authorisation requests for a January start arrive in the first week of
 * December, and the eligibility files that build the January membership arrive
 * before that. An agent whose policy begins on the first of the plan year would
 * have worked its first six weeks under no policy at all, which the invariant
 * suite treats as a failure and is right to.
 */
const GO_LIVE = new Date(Date.UTC(PLAN_YEAR - 1, 10, 1));

interface PolicyStep {
  agentId: string;
  autonomy: string;
  rationale: string;
  setBy: string;
  from: Date;
}

const TIMELINE: PolicyStep[] = [
  {
    agentId: "pa-intake",
    autonomy: "Propose",
    rationale:
      "New agent. Every answer set is checked field by field against the note by a technician before the tree is walked.",
    setBy: "Clinical operations pharmacist",
    from: GO_LIVE,
  },
  {
    agentId: "pa-intake",
    autonomy: "ActWithReview",
    rationale:
      "Extraction accuracy held above the 97% target across the first 620 requests, and no denial has ever been issued without a pharmacist. Answer sets now stand unless reversed; denials continue to be held.",
    setBy: "Clinical operations pharmacist",
    from: d(2, 2),
  },

  {
    agentId: "plan-design",
    autonomy: "Propose",
    rationale:
      "A benefit change is the plan sponsor's decision. There is no level above this one for this agent, and there will not be.",
    setBy: "Chief executive",
    from: GO_LIVE,
  },

  {
    agentId: "integrity-triage",
    autonomy: "Propose",
    rationale:
      "Case narratives reviewed in full while the detectors and the agent are calibrated against each other.",
    setBy: "Fraud, waste and abuse pharmacist",
    from: GO_LIVE,
  },
  {
    agentId: "integrity-triage",
    autonomy: "ActWithReview",
    rationale:
      "Narratives are now attached to signals as they score. The pharmacist still decides every action, and referral and lock-in remain held whatever this level says.",
    setBy: "Fraud, waste and abuse pharmacist",
    from: d(4, 1),
  },

  {
    agentId: "eligibility-resolver",
    autonomy: "Propose",
    rationale:
      "Corrections reviewed individually until the reversal path was tested end to end.",
    setBy: "Eligibility operations manager",
    from: GO_LIVE,
  },
  {
    agentId: "eligibility-resolver",
    autonomy: "ActWithReview",
    rationale:
      "Reversible corrections apply on their own and the worklist aging fell from eighteen days to under two. Anything that ends a member's coverage still goes to a person.",
    setBy: "Eligibility operations manager",
    from: d(3, 1),
  },

  {
    agentId: "appeal-drafter",
    autonomy: "Propose",
    rationale:
      "A response to a pharmacy appeal is a statutory document. A pharmacist signs every one, and the level does not move.",
    setBy: "Network contracting pharmacist",
    from: GO_LIVE,
  },

  {
    agentId: "member-service",
    autonomy: "Propose",
    rationale:
      "Answers drafted for a representative to send, while the tool layer was checked against the adjudication engine.",
    setBy: "Member services supervisor",
    from: GO_LIVE,
  },
  {
    agentId: "member-service",
    autonomy: "ActWithReview",
    rationale:
      "Answers now go to the member directly and are sampled at 20% by a supervisor.",
    setBy: "Member services supervisor",
    from: d(1, 16),
  },
  {
    agentId: "member-service",
    autonomy: "Act",
    rationale:
      "The agent computes nothing: every figure it states is returned by a tool that reads the same book the claim was adjudicated against. Sampling found no incorrect figure in four months. Clinical questions are refused and handed off, which is checked by the invariant suite rather than by sampling.",
    setBy: "Member services supervisor",
    from: d(5, 1),
  },
];

export async function seedPolicies(prisma: PrismaClient) {
  await prisma.agentPolicy.deleteMany();

  const byAgent = new Map<string, PolicyStep[]>();
  for (const step of TIMELINE) {
    byAgent.set(step.agentId, [...(byAgent.get(step.agentId) ?? []), step]);
  }

  const rows = [];
  for (const [agentId, steps] of byAgent) {
    steps.sort((a, b) => a.from.getTime() - b.from.getTime());
    for (const [i, s] of steps.entries()) {
      rows.push({
        id: `policy-${agentId}-${i}`,
        agentId,
        autonomy: s.autonomy,
        rationale: s.rationale,
        setBy: s.setBy,
        effectiveFrom: s.from,
        effectiveTo: steps[i + 1]?.from ?? null,
      });
    }
  }
  await prisma.agentPolicy.createMany({ data: rows });
  return rows.length;
}
