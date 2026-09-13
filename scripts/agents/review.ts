/**
 * The human half of the record.
 *
 * An agent's run log on its own says nothing about whether the agent is any
 * good. What says that is how often a person looked at what it proposed and
 * did something else, and the operations page reports that as the override
 * rate. So the reviews have to be in the data, and they have to be earned
 * rather than sprinkled on.
 *
 * For prior authorisation intake they are computed exactly: the note carries
 * an answer key, and where the agent's answer set disagrees with the key on a
 * field the traversal actually used, a pharmacist reversed it and said why.
 * Most of those are the decoys — a family history with a number in it, a
 * treatment somebody asked about and never started — which is precisely the
 * error a careless reader makes and a careful one catches.
 *
 * For the other agents the review rates come from the registry's own targets
 * and are applied deterministically, which is stated on the methodology page
 * rather than implied to be measured.
 */

import { PrismaClient } from "../../src/generated/prisma/index.js";
import { Rng } from "../seed/population.js";
import { reviewProposal } from "../../src/lib/agents/actions/execute.js";

const REVIEWERS: Record<string, string> = {
  "pa-intake": "K. Osei, PharmD",
  "plan-design": "Steel Potatoes benefits committee",
  "integrity-triage": "R. Delgado, PharmD",
  "eligibility-resolver": "M. Whitfield, eligibility operations",
  "appeal-drafter": "T. Nakamura, PharmD",
  "member-service": "L. Brennan, member services supervisor",
};

const REVIEWER_ROLES: Record<string, string> = {
  "pa-intake": "pharmacist",
  "plan-design": "plan_sponsor",
  "integrity-triage": "pharmacist",
  "eligibility-resolver": "ops",
  "appeal-drafter": "pharmacist",
  "rebate-collections": "ops",
  "guarantee-credit": "plan_sponsor",
};

/** How often a reviewer disagrees, where it is not computed from the data. */
const OVERRIDE_RATE: Record<string, number> = {
  "integrity-triage": 0.13,
  "eligibility-resolver": 0.035,
  "appeal-drafter": 0.09,
  "member-service": 0.008,
};

const OVERRIDE_NOTE: Record<string, string[]> = {
  "integrity-triage": [
    "Reversed to open a case. The alternative explanation is reasonable but the member's three pharmacies are not on the same dispensing system, so nobody was looking at the whole picture at the counter.",
    "Reversed to close. The prescriber is palliative care and the specialty on the NPI record is out of date, which the agent flagged as a possibility and I have now confirmed with the licensing board.",
    "Recommendation stands but the action does not. Lock-in is disproportionate on this evidence; requesting records from the two highest-exposure prescribers first.",
    "Reversed to close. The two members on this contract are a parent and an adult child with the same first initial, and the fills belong to different people.",
  ],
  "eligibility-resolver": [
    "The dates were not transposed. Payroll confirmed the member was rehired, so this is a second span rather than a correction to the first.",
    "Correction is right but the plan is not. This subsidiary moved to the high-deductible plan in July and the agent used the span that predates that.",
    "Returned to the sponsor rather than corrected. The person code matches but the date of birth on file is eleven years out, which needs the employer to resolve.",
  ],
  "appeal-drafter": [
    "Cited product is a discontinued package. Redrafted citing a currently listed NDC before sending.",
    "Overturned rather than upheld. The product the agent found is available nationally but not to this pharmacy's wholesaler, and the statute asks what was available to them.",
    "Upheld rather than overturned. The pharmacy's invoice is for a brand package where a generic was available, which is not a MAC problem.",
  ],
  "member-service": [
    "Answer was right but the tone was wrong for a bereavement call. Supervisor recontacted the member.",
  ],
};

export async function reviewProposals(prisma: PrismaClient) {
  const proposals = await prisma.agentProposal.findMany({
    include: { run: { select: { subjectId: true, subjectType: true, endedAt: true } } },
  });

  const notes = new Map<string, string>();
  for (const n of await prisma.clinicalNote.findMany({
    select: { paId: true, groundTruth: true },
  })) {
    notes.set(n.paId, n.groundTruth);
  }

  /*
   * The committee took the first recommendation it was given and has held the
   * rest for the new plan year, which is what a benefits committee does with a
   * saving that has a member disruption count attached to it. Deciding this by
   * date rather than by position in the list keeps the accepted one the same
   * whichever order the proposals come back in.
   */
  const takenByCommittee = proposals
    .filter((p) => p.agentId === "plan-design")
    .sort((a, b) => a.run.endedAt.getTime() - b.run.endedAt.getTime())[0]?.id;

  let overrides = 0;
  let approvals = 0;

  for (const [i, p] of proposals.entries()) {
    // Reversible actions have already passed through the effect executor under
    // policy. This batch simulates the human decision for proposals that were
    // deliberately held; it must not manufacture a second review record.
    if (p.status !== "Proposed") continue;
    const rng = new Rng(0x5eed + i * 2654435761);
    const reviewer = REVIEWERS[p.agentId] ?? "Operations";
    let override: string | null = null;

    if (p.agentId === "pa-intake") {
      override = intakeOverride(p, notes.get(p.subjectId ?? "") ?? null);
    } else if (p.agentId === "plan-design") {
      override =
        p.id === takenByCommittee
          ? null
          : "Deferred to the next plan year. The saving is real but the committee will not change a benefit mid-year without notifying members first.";
    } else {
      const rate = OVERRIDE_RATE[p.agentId] ?? 0;
      if (rng.next() < rate) {
        const bank = OVERRIDE_NOTE[p.agentId] ?? [];
        override = bank.length > 0 ? rng.pick(bank) : "Reversed on review.";
      }
    }

    if (override) {
      overrides++;
      await reviewProposal({
        proposalId: p.id,
        decision: "Rejected",
        reviewer: {
          label: reviewer,
          role: REVIEWER_ROLES[p.agentId] ?? "admin",
        },
        note: override,
      });
    } else {
      approvals++;
      await reviewProposal({
        proposalId: p.id,
        decision: "Approved",
        reviewer: {
          label: reviewer,
          role: REVIEWER_ROLES[p.agentId] ?? "admin",
        },
      });
    }
  }

  return { reviewed: proposals.length, overrides, approvals };
}

/**
 * Did the agent's answer set disagree with the note, on a field the traversal
 * used? That, and only that, is a reversal.
 */
function intakeOverride(
  p: { payload: string },
  groundTruth: string | null,
): string | null {
  if (!groundTruth) return null;
  let payload: {
    answers?: Record<string, unknown>;
    condition?: string;
    specialty?: string;
    path?: { step: number }[];
  };
  let truth: Record<string, unknown>;
  try {
    payload = JSON.parse(p.payload);
    truth = JSON.parse(groundTruth);
  } catch {
    return null;
  }

  const got = (key: string): string | null => {
    if (key === "__condition") return payload.condition ?? null;
    if (key === "__specialty") return payload.specialty ?? null;
    const raw = payload.answers?.[key];
    if (raw === undefined) return null;
    if (Array.isArray(raw)) return raw.length === 0 ? "__none" : String(raw[0]);
    return String(raw);
  };

  for (const [key, want] of Object.entries(truth)) {
    if (want === null || want === undefined) continue;
    const mine = got(key);
    if (mine === null) continue;
    if (mine === String(want)) continue;
    return `Extraction is wrong on ${humanField(key)}: the note supports "${String(want)}" and the agent recorded "${mine}". Corrected by hand before the tree was walked.`;
  }
  return null;
}

function humanField(key: string): string {
  switch (key) {
    case "__condition":
      return "the indication";
    case "__specialty":
      return "the prescriber's specialty";
    case "diagnosisCriteria":
      return "the qualifying diagnosis";
    case "phototherapyTrial":
      return "the trial of phototherapy, methotrexate or acitretin";
    case "topicalTrialDocumented":
      return "the topical trial";
    case "conventionalTherapyTrial":
      return "the conventional therapy trial";
    case "preferredBiosimilarOrFailure":
      return "the preferred biosimilar question";
    default:
      return key;
  }
}
