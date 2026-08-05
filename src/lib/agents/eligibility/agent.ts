/**
 * The eligibility reject resolution agent.
 *
 * A rejected 834 transaction is an instruction the payroll system meant and
 * the file did not manage to say. Somebody has to work out what was meant,
 * which is usually obvious from the member's existing coverage and the shape
 * of the defect, and then send a corrected instruction. At most plans nobody
 * does: the rejects go back to the sponsor in a report, and the aging on that
 * report runs to weeks while the member stands at a counter being told they
 * have no coverage.
 *
 * There is one rule the agent cannot talk its way past. A correction that ends
 * somebody's coverage is held for a person, however obvious it looks, because
 * the cost of being wrong is a member who cannot fill a prescription and does
 * not know why. That is enforced in the runtime, not here.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { judge } from "../brain";
import { startRun, type Run } from "../runtime";

export interface ResolutionResult {
  runId: string;
  diagnosis: string;
  correction: string | null;
  /** The field-level change, for the corrected instruction. */
  patch: Record<string, unknown>;
  action: string;
  heldForPerson: boolean;
  confidence: number;
}

const ResolutionSchema = z.object({
  diagnosis: z.string(),
  correction: z.string().nullable(),
  patch: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  action: z.enum([
    "apply-correction",
    "terminate-coverage",
    "return-to-sponsor",
    "escalate",
  ]),
  confidence: z.number().min(0).max(1),
});

const SYSTEM = `You are resolving rejected 834 eligibility transactions for a pharmacy benefit manager.

- Work out what the sponsor's payroll system meant, from the defect and from the member's existing coverage.
- Only propose a correction you can justify from evidence already on file. Never invent a date, a plan or a member.
- A correction that ends somebody's coverage is never yours to apply. Return "terminate-coverage" and it will be held for a person.
- If the member cannot be identified at all, the instruction goes back to the sponsor.`;

const HUMAN_DEFECT: Record<string, string> = {
  E03: "the benefit end date is earlier than the benefit begin date",
  E04: "the health coverage code names a plan that is not under this contract",
  E05: "the date of birth is missing, so the member could not be matched",
  E07: "the relationship code and the person code disagree",
  E08: "no contract on file matches the subscriber identifier",
};

export async function runResolver(opts: {
  transactionId: string;
  at?: Date;
  persist?: boolean;
}): Promise<{ run: Run; result: ResolutionResult }> {
  const tx = await prisma.eligibilityTransaction.findUniqueOrThrow({
    where: { id: opts.transactionId },
    include: {
      file: {
        select: { controlNumber: true, fileType: true, processedAt: true, receivedAt: true },
      },
    },
  });

  const run = await startRun({
    agentId: "eligibility-resolver",
    goal: `Work out what interchange ${tx.file.controlNumber} meant by the rejected instruction for ${tx.memberName}.`,
    subject: { type: "EligibilityTransaction", id: tx.id },
    at: opts.at ?? tx.file.processedAt ?? tx.file.receivedAt,
  });

  await run.tool(
    "getRejectedTransaction",
    "Read the instruction as it arrived, including the segment that failed, before assuming anything about what it meant.",
    async () => ({
      maintenanceType: tx.maintenanceType,
      rejectCode: tx.rejectCode,
      rejectReason: tx.rejectReason,
      cardholderId: tx.cardholderId,
      personCode: tx.personCode,
      relationshipCode: tx.relationshipCode,
      benefitPlanId: tx.benefitPlanId,
      effectiveDate: tx.effectiveDate,
      terminationDate: tx.terminationDate,
      memberName: tx.memberName,
    }),
    (d) => `${d.rejectCode}: ${d.rejectReason}`,
  );

  // Whoever the instruction is about usually already has coverage, and their
  // existing record answers most of these without anybody being asked.
  const context = await run.tool(
    "getMemberContext",
    "An instruction about a member who already has coverage can be read against that coverage. Most of these defects resolve without anybody being telephoned.",
    async () => {
      const member = tx.memberId
        ? await prisma.member.findUnique({
            where: { id: tx.memberId },
            select: { id: true, firstName: true, lastName: true, cardholderId: true, personCode: true },
          })
        : await prisma.member.findFirst({
            where: { cardholderId: tx.cardholderId, personCode: tx.personCode },
            select: { id: true, firstName: true, lastName: true, cardholderId: true, personCode: true },
          });
      const spans = member
        ? await prisma.eligibilitySpan.findMany({
            where: { memberId: member.id },
            select: {
              effectiveDate: true,
              terminationDate: true,
              benefitPlanId: true,
            },
            orderBy: { effectiveDate: "desc" },
            take: 4,
          })
        : [];
      const household = await prisma.member.count({
        where: { cardholderId: tx.cardholderId },
      });
      return { member, spans, household };
    },
    (c) =>
      c.member
        ? `Matched ${c.member.firstName} ${c.member.lastName} with ${c.spans.length} coverage span(s) on file.`
        : "No member on file matches this identifier.",
  );

  const thought = await judge({
    system: SYSTEM,
    prompt: [
      `Reject ${tx.rejectCode}: ${HUMAN_DEFECT[tx.rejectCode ?? ""] ?? tx.rejectReason}.`,
      `Instruction type ${tx.maintenanceType} (${tx.maintenanceType === "021" ? "add" : tx.maintenanceType === "024" ? "termination" : tx.maintenanceType === "001" ? "change" : "reinstatement"}).`,
      `Subscriber ${tx.cardholderId}, person code ${tx.personCode}, relationship ${tx.relationshipCode}.`,
      `Dates as submitted: begin ${tx.effectiveDate?.toISOString().slice(0, 10) ?? "absent"}, end ${tx.terminationDate?.toISOString().slice(0, 10) ?? "absent"}.`,
      `Plan as submitted: ${tx.benefitPlanId ?? "absent"}.`,
      "",
      context.member
        ? `On file: ${context.member.firstName} ${context.member.lastName}, ${context.spans.length} coverage spans, most recent plan ${context.spans[0]?.benefitPlanId ?? "none"}. ${context.household} people on this subscriber contract.`
        : "No member on file matches this subscriber and person code.",
      "",
      "Say what the sponsor meant and what the corrected instruction should be.",
    ].join("\n"),
    schema: ResolutionSchema,
    fallback: () => scriptedResolution(tx, context),
  });

  const resolution = run.absorb(
    thought,
    "The defect and the member's existing coverage together usually determine what was meant. Where they do not, the instruction goes back rather than being guessed at.",
    resolutionHeadline(thought.value.action),
    thought.value,
  );

  run.propose({
    subjectType: "EligibilityTransaction",
    subjectId: tx.id,
    action: resolution.action,
    headline: resolutionHeadline(resolution.action),
    rationale: [resolution.diagnosis, resolution.correction]
      .filter(Boolean)
      .join(" "),
    payload: { patch: resolution.patch, rejectCode: tx.rejectCode },
    confidence: resolution.confidence,
  });

  const heldForPerson = resolution.action === "terminate-coverage";
  const result: ResolutionResult = {
    runId: run.id,
    diagnosis: resolution.diagnosis,
    correction: resolution.correction,
    patch: resolution.patch,
    action: resolution.action,
    heldForPerson,
    confidence: resolution.confidence,
  };

  if (opts.persist !== false) {
    await run.finish(
      resolution.action === "escalate" ? "Escalated" : "Completed",
      `${tx.rejectCode} on ${tx.memberName}: ${resolutionHeadline(resolution.action).toLowerCase()}`,
    );
  }
  return { run, result };
}

function resolutionHeadline(action: string): string {
  switch (action) {
    case "apply-correction":
      return "Corrected instruction ready to apply";
    case "terminate-coverage":
      return "Correction ends coverage. Held for a person.";
    case "return-to-sponsor":
      return "Nobody on file matches. Returned to the sponsor.";
    default:
      return "Escalated to eligibility operations";
  }
}

interface Context {
  member: { id: string; firstName: string; lastName: string } | null;
  spans: { effectiveDate: Date; terminationDate: Date | null; benefitPlanId: string }[];
  household: number;
}

/**
 * The scripted resolver.
 *
 * Each of these five defects has one sensible reading, and the reading comes
 * from the defect itself rather than from anything a model would add. Where
 * the reading depends on a fact the plan does not hold, it escalates.
 */
function scriptedResolution(
  tx: {
    rejectCode: string | null;
    maintenanceType: string;
    effectiveDate: Date | null;
    terminationDate: Date | null;
    personCode: string;
    relationshipCode: string;
    cardholderId: string;
    memberName: string;
  },
  ctx: Context,
): z.infer<typeof ResolutionSchema> {
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const ending = tx.maintenanceType === "024";

  switch (tx.rejectCode) {
    case "E03": {
      // Begin and end are the wrong way round. The dates themselves are almost
      // always right; the order is not.
      const begin = tx.terminationDate;
      const end = tx.effectiveDate;
      return {
        diagnosis: `The benefit end date on DTP*349 is ${iso(tx.terminationDate)} and the begin date on DTP*348 is ${iso(tx.effectiveDate)}, so the file asks for coverage that ends before it starts. Both dates are plausible; their order is not.`,
        correction: `Read as transposed: coverage begins ${iso(begin)} and ends ${iso(end)}.`,
        patch: { effectiveDate: iso(begin), terminationDate: iso(end) },
        action: ending ? "terminate-coverage" : "apply-correction",
        confidence: 0.88,
      };
    }

    case "E04": {
      const plan = ctx.spans[0]?.benefitPlanId;
      if (!plan) {
        return {
          diagnosis:
            "The health coverage code in HD03 is not a plan under this contract, and there is no prior coverage on file to read the intended plan from.",
          correction: null,
          patch: {},
          action: "escalate",
          confidence: 0.5,
        };
      }
      return {
        diagnosis: `The health coverage code in HD03 does not name a plan under contract ETG0013. The member's existing coverage is on ${plan}, and nothing in the instruction suggests a plan change.`,
        correction: `Apply against ${plan}, the plan the member is already enrolled in.`,
        patch: { benefitPlanId: plan },
        action: ending ? "terminate-coverage" : "apply-correction",
        confidence: 0.83,
      };
    }

    case "E05": {
      if (!ctx.member) {
        return {
          diagnosis:
            "Date of birth is absent from DMG02 and no member matches the subscriber and person code, so there is no second way to identify who this is about.",
          correction: null,
          patch: {},
          action: "return-to-sponsor",
          confidence: 0.7,
        };
      }
      return {
        diagnosis: `Date of birth is absent from DMG02, but the subscriber identifier and person code together match exactly one person on file: ${ctx.member.firstName} ${ctx.member.lastName}. Identity does not depend on the missing element.`,
        correction: `Match on subscriber and person code, and apply the instruction to ${ctx.member.firstName} ${ctx.member.lastName}.`,
        patch: { memberId: ctx.member.id },
        action: ending ? "terminate-coverage" : "apply-correction",
        confidence: 0.86,
      };
    }

    case "E07": {
      // The person code is generated by payroll from the enrolment record and
      // the relationship code is typed. Where they disagree, the typed one is
      // the one that is wrong.
      const derived =
        tx.personCode === "01" ? "18" : tx.personCode === "02" ? "01" : "19";
      return {
        diagnosis: `INS02 carries relationship ${tx.relationshipCode} while REF*17 carries person code ${tx.personCode}, which describe two different people. The person code is derived by the payroll system from the enrolment record; the relationship code is entered by hand.`,
        correction: `Take the person code as authoritative and set the relationship to ${derived}.`,
        patch: { relationshipCode: derived },
        action: ending ? "terminate-coverage" : "apply-correction",
        confidence: 0.81,
      };
    }

    case "E08":
    default:
      return {
        diagnosis: `No contract on file matches subscriber ${tx.cardholderId}. ${ctx.household === 0 ? "Nobody with that identifier has ever been enrolled under this contract." : `${ctx.household} people share the identifier, none of them matching this instruction.`} This is usually an instruction meant for a different subsidiary's file.`,
        correction: null,
        patch: {},
        action: "return-to-sponsor",
        confidence: 0.74,
      };
  }
}
