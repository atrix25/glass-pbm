/**
 * The program integrity triage agent.
 *
 * A detector produces a score. A score is not a case. Somebody still has to
 * pull the fills, lay them on a timeline, look for the boring explanation, and
 * write down what they think should happen — and that hour of work, repeated
 * across every signal, is why most plans triage the top ten and leave the rest.
 *
 * The agent does the legwork and writes the case. It does not contact anybody,
 * it does not refer anybody, and it does not lock anybody into a pharmacy.
 * Those actions are marked consequential in the registry and the runtime will
 * not let them apply without a pharmacist, whatever autonomy the agent is on.
 *
 * The most useful thing it produces is the paragraph nobody writes: the
 * innocent explanation. A member with four prescribers and three pharmacies is
 * usually a member with four doctors and three pharmacies.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { judge } from "../brain";
import { startRun, type Run } from "../runtime";
import { formatCents } from "@/lib/money";

export interface TriageResult {
  runId: string;
  narrative: string;
  alternative: string;
  recommendation: string;
  action: string;
  timeline: { date: string; label: string; detail: string }[];
}

const AssessmentSchema = z.object({
  narrative: z.string(),
  alternative: z.string(),
  recommendation: z.string(),
  action: z.enum(["open-case", "close-benign", "refer-to-siu", "lock-in-member"]),
  confidence: z.number().min(0).max(1),
});

const SYSTEM = `You are a pharmacy benefit fraud, waste and abuse analyst preparing a case file.

- Describe what the data shows before you interpret it.
- Always state the innocent explanation, in full, even when you do not believe it. A member with several prescribers usually has several doctors.
- Recommend the least intrusive action that fits the evidence.
- You are preparing the case, not deciding it. A pharmacist signs anything that reaches a member, a prescriber or a pharmacy.`;

/** Names the detector, in language a person outside the team would follow. */
const DETECTOR_PLAIN: Record<string, string> = {
  "member.opioid-overutilisation":
    "the member's cumulative daily morphine equivalent, prescriber count and pharmacy count all exceed the CMS overutilisation criteria at once",
  "member.controlled-shopping":
    "the member uses more prescribers and more pharmacies for controlled substances than members who fill at a similar rate",
  "prescriber.controlled-share":
    "the share of this prescriber's claims that are controlled substances is high against others in the same specialty",
  "pharmacy.mix":
    "the share of this pharmacy's dispensing that is controlled substances is high against pharmacies of similar size",
};

export async function runTriage(opts: {
  signalId: string;
  at?: Date;
  persist?: boolean;
}): Promise<{ run: Run; result: TriageResult }> {
  const signal = await prisma.integritySignal.findUniqueOrThrow({
    where: { id: opts.signalId },
  });

  const run = await startRun({
    agentId: "integrity-triage",
    goal: `Work up the ${signal.severity.toLowerCase()} signal on ${signal.subjectLabel} into a case a pharmacist can act on.`,
    subject: { type: "IntegritySignal", id: signal.id },
    at: opts.at ?? signal.windowEnd,
  });

  await run.tool(
    "getSignal",
    "Start from what the detector actually measured, and against which peer group, because the peer group is where most of these fall apart.",
    async () => ({
      detector: signal.detectorId,
      observed: signal.observed,
      peerMedian: signal.peerMedian,
      peerP95: signal.peerP95,
      score: signal.score,
      claims: signal.claimCount,
      exposureCents: signal.exposureCents,
      evidence: JSON.parse(signal.evidenceJson) as unknown[],
    }),
    (d) =>
      `Observed ${d.observed.toFixed(1)} against a peer median of ${d.peerMedian.toFixed(1)} and a 95th percentile of ${d.peerP95.toFixed(1)}.`,
  );

  const timeline: TriageResult["timeline"] = [];
  let context = "";

  if (signal.subjectType === "member") {
    const fills = await run.tool(
      "getMemberFills",
      "A count of prescribers is an argument. A timeline of fills is evidence, and it is where an overlap either exists or does not.",
      async () => {
        const claims = await prisma.claim.findMany({
          where: {
            memberId: signal.subjectId,
            dateOfService: { gte: signal.windowStart, lte: signal.windowEnd },
            responseStatus: "P",
          },
          select: {
            drugId: true,
            dateOfService: true,
            daysSupply: true,
            prescriberNpi: true,
            totalBilledCents: true,
            drug: { select: { name: true, molecule: true } },
            pharmacy: { select: { name: true, chainName: true, city: true } },
          },
          orderBy: { dateOfService: "asc" },
          take: 300,
        });
        return claims;
      },
      (c) => `${c.length} paid fills in the window.`,
    );

    /*
     * Which of those fills are opioids has to be decided the same way the
     * detector decided it, by membership of the published product table, not
     * by a schedule column on the drug record. They are not the same question
     * and only one of them is populated: reading the column silently returned
     * nothing, so every case worked up to "0 controlled fills" while the
     * detector that raised it had counted five.
     */
    const opioidDrugIds = new Set(
      (
        await prisma.opioidProduct.findMany({
          where: { drugId: { in: [...new Set(fills.map((f) => f.drugId))] } },
          select: { drugId: true },
        })
      ).map((o) => o.drugId),
    );

    const controlled = fills.filter((f) => opioidDrugIds.has(f.drugId));
    const prescribers = new Set(
      controlled.map((f) => f.prescriberNpi).filter(Boolean),
    );
    const pharmacies = new Set(controlled.map((f) => f.pharmacy.name));
    const chains = new Set(
      controlled.map((f) => f.pharmacy.chainName ?? f.pharmacy.name),
    );
    const cities = new Set(controlled.map((f) => f.pharmacy.city));

    // Two fills of the same molecule whose days supply overlap is the thing a
    // reviewer is looking for, and the thing a count of pharmacies only hints at.
    let overlaps = 0;
    const byMolecule = new Map<string, typeof controlled>();
    for (const f of controlled) {
      const key = f.drug.molecule ?? f.drug.name;
      byMolecule.set(key, [...(byMolecule.get(key) ?? []), f]);
    }
    for (const [, list] of byMolecule) {
      for (let i = 1; i < list.length; i++) {
        const prevEnd =
          list[i - 1].dateOfService.getTime() +
          (list[i - 1].daysSupply ?? 0) * 86_400_000;
        if (list[i].dateOfService.getTime() < prevEnd - 3 * 86_400_000) {
          overlaps++;
          timeline.push({
            date: list[i].dateOfService.toISOString().slice(0, 10),
            label: `Early refill of ${list[i].drug.name}`,
            detail: `${Math.round((prevEnd - list[i].dateOfService.getTime()) / 86_400_000)} days of the previous supply remained, filled at ${list[i].pharmacy.name}.`,
          });
        }
      }
    }

    run.evidence(
      `${controlled.length} controlled fills across ${prescribers.size} prescribers and ${pharmacies.size} pharmacies`,
      `${chains.size} distinct chains in ${cities.size} ${cities.size === 1 ? "city" : "cities"}; ${overlaps} fills landed while a previous supply of the same molecule was still running.`,
      {
        controlled: controlled.length,
        totalFills: fills.length,
        prescribers: prescribers.size,
        pharmacies: pharmacies.size,
        overlaps,
      },
    );

    context = [
      `Controlled fills: ${controlled.length} of ${fills.length} total.`,
      `Distinct prescribers of controlled substances: ${prescribers.size}.`,
      `Distinct pharmacies: ${pharmacies.size}, across ${chains.size} chains and ${cities.size} cities.`,
      `Overlapping fills of the same molecule: ${overlaps}.`,
      `Plan exposure in the window: ${formatCents(signal.exposureCents)}.`,
      cities.size === 1
        ? "Every pharmacy used is in one city."
        : `Pharmacies span ${[...cities].slice(0, 4).join(", ")}.`,
      chains.size === 1 && pharmacies.size > 1
        ? "All pharmacies used belong to the same chain, which shares a dispensing record."
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  } else if (signal.subjectType === "prescriber") {
    const pattern = await run.tool(
      "getPrescriberPattern",
      "A high controlled share is expected in some specialties and not in others, so the comparison has to be against the right peer group before it means anything.",
      async () => {
        const rows = await prisma.$queryRaw<
          { name: string; molecule: string | null; n: bigint; cents: bigint }[]
        >`
          SELECT d.name AS name, o.molecule AS molecule,
                 COUNT(*) AS n, SUM(c.totalBilledCents) AS cents
          FROM Claim c
          JOIN Drug d ON d.id = c.drugId
          LEFT JOIN OpioidProduct o ON o.drugId = c.drugId
          WHERE c.prescriberNpi = ${signal.subjectId}
            AND c.responseStatus = 'P'
            AND c.dateOfService BETWEEN ${signal.windowStart} AND ${signal.windowEnd}
          GROUP BY 1, 2 ORDER BY n DESC LIMIT 12`;
        return rows.map((r) => ({
          name: r.name,
          molecule: r.molecule,
          claims: Number(r.n),
          cents: Number(r.cents),
        }));
      },
      (r) => `${r.length} distinct products written in the window.`,
    );
    const top = pattern.slice(0, 5);
    context = [
      `Most written products: ${top.map((p) => `${p.name} (${p.claims}${p.molecule ? ", opioid" : ""})`).join("; ")}.`,
      `Controlled share observed ${(signal.observed * 100).toFixed(0)}% against a specialty median of ${(signal.peerMedian * 100).toFixed(0)}%.`,
      `Total claims in the window: ${signal.claimCount}.`,
    ].join("\n");
    run.evidence(
      `Concentrated in ${top.length} products`,
      top.map((p) => `${p.name}: ${p.claims} claims`).join(", "),
      top,
    );
  } else {
    const pattern = await run.tool(
      "getPharmacyPattern",
      "Dispensing mix is a function of what is around the pharmacy. A store next to a pain clinic looks like a pill mill on a ratio and is not one.",
      async () => {
        const rows = await prisma.$queryRaw<
          { name: string; molecule: string | null; n: bigint }[]
        >`
          SELECT d.name AS name, o.molecule AS molecule, COUNT(*) AS n
          FROM Claim c
          JOIN Drug d ON d.id = c.drugId
          LEFT JOIN OpioidProduct o ON o.drugId = c.drugId
          WHERE c.pharmacyId = ${signal.subjectId}
            AND c.responseStatus = 'P'
            AND c.dateOfService BETWEEN ${signal.windowStart} AND ${signal.windowEnd}
          GROUP BY 1, 2 ORDER BY n DESC LIMIT 12`;
        const pharmacy = await prisma.pharmacy.findUnique({
          where: { id: signal.subjectId },
          select: { name: true, city: true, chainName: true, pharmacyType: true },
        });
        return {
          pharmacy,
          products: rows.map((r) => ({
            name: r.name,
            molecule: r.molecule,
            claims: Number(r.n),
          })),
        };
      },
      (r) => `${r.products.length} distinct products dispensed.`,
    );
    context = [
      `${pattern.pharmacy?.name ?? signal.subjectLabel} in ${pattern.pharmacy?.city ?? "an unrecorded city"}, ${pattern.pharmacy?.pharmacyType === "Independent" ? "independent" : (pattern.pharmacy?.chainName ?? pattern.pharmacy?.pharmacyType ?? "chain")}.`,
      `Controlled share observed ${(signal.observed * 100).toFixed(0)}% against a median of ${(signal.peerMedian * 100).toFixed(0)}% for pharmacies of similar volume.`,
      `Most dispensed: ${pattern.products
        .slice(0, 5)
        .map((p) => `${p.name} (${p.claims})`)
        .join("; ")}.`,
    ].join("\n");
  }

  const thought = await judge({
    system: SYSTEM,
    prompt: [
      `Signal: ${signal.detectorId}. In plain terms, ${DETECTOR_PLAIN[signal.detectorId] ?? "the subject sits well outside its peer group"}.`,
      `Subject: ${signal.subjectLabel} (${signal.subjectType}).`,
      `Severity ${signal.severity}, ${signal.score.toFixed(1)} on the detector's scale.`,
      "",
      context,
      "",
      "Write the case: what the data shows, the innocent explanation, and what should happen next.",
    ].join("\n"),
    schema: AssessmentSchema,
    fallback: () => scriptedAssessment(signal, context),
  });

  const assessment = run.absorb(
    thought,
    "The numbers are gathered. What is left is the judgement a person would make from them, and the alternative explanation that judgement has to survive.",
    assessmentHeadline(thought.value.action),
    thought.value,
  );

  run.propose({
    subjectType: "IntegritySignal",
    subjectId: signal.id,
    action: assessment.action,
    headline: assessmentHeadline(assessment.action),
    rationale: assessment.recommendation,
    payload: {
      narrative: assessment.narrative,
      alternative: assessment.alternative,
      timeline,
    },
    confidence: assessment.confidence,
  });

  const result: TriageResult = {
    runId: run.id,
    narrative: assessment.narrative,
    alternative: assessment.alternative,
    recommendation: assessment.recommendation,
    action: assessment.action,
    timeline,
  };

  if (opts.persist !== false) {
    await run.finish("Completed", `${signal.subjectLabel}: ${assessmentHeadline(assessment.action)}`);
  }
  return { run, result };
}

function assessmentHeadline(action: string): string {
  switch (action) {
    case "close-benign":
      return "Close. The pattern has an ordinary explanation.";
    case "refer-to-siu":
      return "Refer to special investigations. Held for a pharmacist.";
    case "lock-in-member":
      return "Consider pharmacy lock-in. Held for a pharmacist.";
    default:
      return "Open a case for pharmacist review.";
  }
}

/**
 * The scripted analyst.
 *
 * It reaches the same four conclusions from the same evidence, in the same
 * order a reviewer would: overlap and geography first, then concentration,
 * then severity. It is wordier than a model and less graceful, and it is what
 * runs when there is no key.
 */
function scriptedAssessment(
  signal: { detectorId: string; subjectLabel: string; severity: string; score: number; observed: number; peerMedian: number; claimCount: number; exposureCents: number },
  context: string,
): z.infer<typeof AssessmentSchema> {
  const overlaps = Number(context.match(/same molecule: (\d+)/)?.[1] ?? 0);
  const oneChain = /same chain/.test(context);
  const oneCity = /one city/.test(context);
  const times = signal.peerMedian === 0 ? 0 : signal.observed / signal.peerMedian;

  const narrative = `${signal.subjectLabel} sits at ${signal.observed.toFixed(1)} against a peer median of ${signal.peerMedian.toFixed(1)}, which is ${times.toFixed(1)} times the middle of the comparison group and ${signal.score.toFixed(1)} on the detector's scale. ${context.split("\n")[0]} Plan exposure across the window is ${formatCents(signal.exposureCents)} over ${signal.claimCount} claims.`;

  if (oneChain || (oneCity && overlaps === 0)) {
    return {
      narrative,
      alternative: oneChain
        ? "Every pharmacy used belongs to one chain. Chains share a dispensing record across stores, so a pharmacist reviewed each of these fills against the others at the point of sale. The pharmacy count is an artefact of where the member happened to be, not of concealment."
        : "All of the dispensing is in one city and no fill overlaps another. This is what an ordinary member with more than one treating physician looks like.",
      recommendation:
        "Close with no action. The distinguishing feature of diversion is concealment across systems that cannot see each other, and that is absent here. Note the closure so the detector does not re-raise the same subject next month.",
      action: "close-benign",
      confidence: 0.78,
    };
  }

  if (
    signal.severity === "High" &&
    overlaps >= 3 &&
    signal.detectorId.startsWith("member.")
  ) {
    return {
      narrative,
      alternative: `The member may be receiving legitimate care from several specialists who are unaware of one another, which happens after a hospital discharge or a change of practice. That would explain the prescriber count. It would not explain ${overlaps} fills that landed while a previous supply of the same molecule was still running, and paid for out of pocket at a pharmacy the others cannot see.`,
      recommendation: `Refer for investigation. Before any contact with the member, confirm the prescriber list against the state prescription drug monitoring programme, since the plan only sees fills it paid for. If the pattern holds, the least intrusive remedy is pharmacy lock-in rather than a coverage action.`,
      action: "refer-to-siu",
      confidence: 0.71,
    };
  }

  if (signal.detectorId.startsWith("prescriber.")) {
    return {
      narrative,
      alternative:
        "A high controlled share is what palliative care, pain management and addiction medicine look like from the outside, and specialty is self-reported on the NPI record, so the peer group may simply be wrong for this prescriber.",
      recommendation:
        "Open a case and verify the specialty against the state licensing board before anything else. If the specialty is right, request records on the ten highest-exposure members rather than contacting the prescriber directly.",
      action: "open-case",
      confidence: 0.66,
    };
  }

  if (signal.detectorId.startsWith("pharmacy.")) {
    return {
      narrative,
      alternative:
        "Dispensing mix follows what is nearby. A pharmacy sited next to a pain clinic, a hospice or a methadone programme will sit at the top of this distribution permanently and legitimately.",
      recommendation:
        "Open a case and check what is within a mile of the pharmacy before reading anything into the ratio. If the surroundings do not explain it, compare the prescriber list against the other pharmacies in the same postcode.",
      action: "open-case",
      confidence: 0.64,
    };
  }

  return {
    narrative,
    alternative:
      "The peer comparison is relative, so somebody is always at the top of it. Being at the top of a distribution is not by itself evidence of anything.",
    recommendation:
      "Open a case for review. The exposure is large enough to be worth an hour of a pharmacist's time, and small enough that nothing should happen before that hour is spent.",
    action: "open-case",
    confidence: 0.6,
  };
}
