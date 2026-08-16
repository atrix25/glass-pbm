/**
 * Exceptions to coverage, appeals, and grievances.
 *
 * These are the paths a member has after a no, and they are seeded rather than
 * left to be filed on stage because the interesting states take days to reach.
 * An exception that has been sitting for a week with no supporting statement is
 * a real and common condition, and it cannot be demonstrated by a form
 * submission a moment ago.
 *
 * Four things are worth watching in what this writes:
 *
 * The clock on an exception starts when the prescriber's supporting statement
 * arrives, not when the member files. One request here has no statement, so its
 * deadline is null and it is deliberately not counted late — the plan is not
 * permitted to decide it yet.
 *
 * An appeal is a separate request that names what it contests, and the reviewer
 * who decides it is not the one who refused the original. Both reviewers are
 * named, so the independence requirement is checkable rather than asserted.
 *
 * A grievance never gets a determination deadline, because it is a complaint
 * about conduct rather than a request for coverage.
 *
 * And every refusal in here, as everywhere else, is signed by a person.
 */

import type { PrismaClient } from "../../src/generated/prisma/index.js";
import { paDeadlines } from "../../src/lib/pa/engine.js";
import { DEMO_MEMBERS } from "./scenarios.js";

/** A second pharmacist, because an appeal cannot be decided by the first one. */
const APPEALS_REVIEWER = "Daniel Okafor, PharmD (WI-RPH-038204)";
const FIRST_REVIEWER = "Rachel Imhoff, PharmD (WI-RPH-041882)";

interface ExceptionCase {
  paNumber: string;
  memberIndex: number;
  kind:
    | "FormularyException"
    | "StepException"
    | "QuantityException"
    | "TieringException"
    | "Appeal"
    | "Grievance";
  /** Day of the plan year the request was filed. */
  filedOn: number;
  /** Days after filing that the prescriber's statement arrived, if it has. */
  statementAfterDays: number | null;
  urgency: "Standard" | "Expedited";
  prescriberName: string;
  drugPicker: { nameContains: string } | { fromAppealOf: string };
  rationale: string;
  /** Days after the clock started that it was decided, or null if still open. */
  decidedAfterHours: number | null;
  outcome: "Approved" | "Denied" | null;
  approvedDays?: number;
  denyReason?: string;
  decidedBy?: string;
  note: string;
}

const CASES: ExceptionCase[] = [
  {
    // Filed and stuck. The member has asked, the prescriber has not written, and
    // the plan cannot lawfully answer, so nothing is overdue.
    paNumber: "EX2026000201",
    memberIndex: 0,
    kind: "FormularyException",
    filedOn: 190,
    statementAfterDays: null,
    urgency: "Standard",
    prescriberName: "Dr. Susan Lindqvist, Internal Medicine",
    drugPicker: { nameContains: "ALTOPREV" },
    rationale:
      "Member asks the plan to cover a product the formulary lists as not covered, on the grounds that she has not tolerated the covered statins and her prescriber wants the extended-release form.",
    decidedAfterHours: null,
    outcome: null,
    note: "Filed. No supporting statement from the prescriber yet, so the deadline has not started and the request is not late.",
  },
  {
    // The statement arrived nine days after filing, and the deadline is measured
    // from that arrival. Decided 40 hours later, which is on time against a
    // clock that started nine days after the member first asked.
    paNumber: "EX2026000202",
    memberIndex: 3,
    kind: "StepException",
    filedOn: 120,
    statementAfterDays: 9,
    urgency: "Standard",
    prescriberName: "Dr. Peter Vandenberg, Gastroenterology",
    drugPicker: { nameContains: "esomeprazole" },
    rationale:
      "Prescriber asks to skip the required trial of the preferred proton pump inhibitor, which the member has already taken without response under a previous employer's plan.",
    decidedAfterHours: 40,
    outcome: "Approved",
    approvedDays: 365,
    decidedBy: FIRST_REVIEWER,
    note: "Approved on the prescriber's statement that the preferred agent was tried for eight weeks without response. The clock ran from the statement, not from the filing nine days earlier.",
  },
  {
    // A quantity limit exception refused, and refused by a person.
    paNumber: "EX2026000203",
    memberIndex: 3,
    kind: "QuantityException",
    filedOn: 210,
    statementAfterDays: 1,
    urgency: "Standard",
    prescriberName: "Dr. Ellen Nakashima, Neurology",
    drugPicker: { nameContains: "sumatriptan" },
    rationale:
      "Prescriber asks to dispense above the published monthly limit for acute migraine treatment.",
    decidedAfterHours: 52,
    outcome: "Denied",
    denyReason:
      "The requested quantity implies use on more than ten days a month, which the supporting statement does not address. Exceeding the limit at that frequency is the pattern the limit exists to detect, and a preventive strategy has not been documented.",
    decidedBy: FIRST_REVIEWER,
    note: "Refused by a pharmacist. The quantity limit is a published edit and the exception was decided on the clinical rationale, not on the arithmetic.",
  },
  {
    // The appeal of the step-8 Skyrizi refusal, decided by somebody else and
    // overturned on documentation that was missing the first time. Kept inside
    // the expedited day so the case demonstrates independent review rather than
    // a turnaround breach; the June incident already owns the late ones.
    paNumber: "AP2026000204",
    memberIndex: 2,
    kind: "Appeal",
    filedOn: 47,
    statementAfterDays: null,
    urgency: "Expedited",
    prescriberName: "Dr. Michael Torres, Dermatology",
    drugPicker: { fromAppealOf: "PA2026000102" },
    rationale:
      "Appeals the refusal recorded on PA2026000102. The prescriber has since documented that phototherapy is not accessible to the member and that methotrexate is contraindicated by liver disease.",
    decidedAfterHours: 18,
    outcome: "Approved",
    approvedDays: 365,
    decidedBy: APPEALS_REVIEWER,
    note: "Overturned on appeal. Decided by a second pharmacist, who did not make the original determination, on contraindication documentation that was not in the first submission.",
  },
  {
    // A complaint about conduct rather than about a decision. No deadline, and
    // it does not disturb the determination it complains about.
    paNumber: "GR2026000205",
    memberIndex: 2,
    kind: "Grievance",
    filedOn: 50,
    statementAfterDays: null,
    urgency: "Standard",
    prescriberName: "Dr. Michael Torres, Dermatology",
    drugPicker: { fromAppealOf: "PA2026000102" },
    rationale:
      "Member states she was told by telephone that the drug was excluded rather than that the criteria had not been met, which sent her to the wrong process and cost her two weeks.",
    decidedAfterHours: 96,
    outcome: null,
    decidedBy: APPEALS_REVIEWER,
    note: "Upheld as a service failure and answered in writing. A grievance does not carry a determination deadline and does not change the coverage decision it complains about.",
  },
];

export async function seedExceptions(
  prisma: PrismaClient,
  deps: { planYear: number },
): Promise<void> {
  const yearStart = Date.UTC(deps.planYear, 0, 1);
  const day = (n: number) => new Date(yearStart + n * 86_400_000);

  let written = 0;
  for (const c of CASES) {
    const member = DEMO_MEMBERS[c.memberIndex];

    let drugId: string | null = null;
    let againstPaNumber: string | null = null;
    let treeId: string | null = null;
    let originalReviewer: string | null = null;

    if ("fromAppealOf" in c.drugPicker) {
      const original = await prisma.priorAuthorization.findUnique({
        where: { paNumber: c.drugPicker.fromAppealOf },
        select: { drugId: true, treeId: true, decidedBy: true, paNumber: true },
      });
      if (!original) continue;
      drugId = original.drugId;
      // Appeals and grievances contest a prior determination; they do not walk
      // the criteria tree again, so they must not inherit a treeId that would
      // imply a deciding step they never took.
      treeId =
        c.kind === "Appeal" || c.kind === "Grievance" ? null : original.treeId;
      againstPaNumber = original.paNumber;
      originalReviewer = original.decidedBy;
    } else {
      const drug = await prisma.drug.findFirst({
        where: { name: { contains: c.drugPicker.nameContains } },
        select: { id: true },
      });
      if (!drug) continue;
      drugId = drug.id;
    }

    /*
     * An appeal decided by the reviewer who made the original determination is
     * not a review of it. The seed refuses to write one rather than producing a
     * demonstration that quietly breaks the rule it is demonstrating.
     */
    if (
      c.kind === "Appeal" &&
      originalReviewer &&
      c.decidedBy &&
      sameReviewer(originalReviewer, c.decidedBy)
    ) {
      throw new Error(
        `Appeal ${c.paNumber} would be decided by ${c.decidedBy}, who made the determination it contests.`,
      );
    }

    const receivedAt = day(c.filedOn);
    const statementAt =
      c.statementAfterDays === null
        ? null
        : new Date(receivedAt.getTime() + c.statementAfterDays * 86_400_000);

    const deadlines = paDeadlines(receivedAt, c.urgency, "Commercial", {
      requestType: c.kind,
      supportingStatementAt: statementAt,
    });
    const sla = deadlines.binding;

    const decidedAt =
      c.decidedAfterHours === null
        ? null
        : new Date(sla.startedAt.getTime() + c.decidedAfterHours * 3_600_000);

    const row = {
      memberId: member.id,
      drugId,
      treeId,
      decidingStepNumber: null as number | null,
      requestType: c.kind,
      urgency: c.urgency,
      prescriberName: c.prescriberName,
      status: statusFor(c, decidedAt),
      determination: c.outcome,
      denyReason: c.denyReason ?? null,
      approvedDays: c.outcome === "Approved" ? (c.approvedDays ?? 365) : null,
      approvedEffectiveDate: c.outcome === "Approved" ? decidedAt : null,
      approvedTerminationDate:
        c.outcome === "Approved" && decidedAt
          ? new Date(
              decidedAt.getTime() + (c.approvedDays ?? 365) * 86_400_000,
            )
          : null,
      receivedAt,
      prescriberStatementAt: statementAt,
      // A grievance is a complaint about conduct, so it has no determination
      // deadline; an exception with no supporting statement has not started
      // one yet. Both are null for different reasons and neither is late.
      decisionDueAt:
        c.kind === "Grievance" || sla.awaitingSupportingStatement
          ? null
          : sla.dueAt,
      decidedAt,
      decidedBy: c.decidedBy ?? null,
      escalated: true,
      reviewerNote: [
        againstPaNumber ? `Contests ${againstPaNumber}.` : null,
        c.rationale,
        c.note,
      ]
        .filter(Boolean)
        .join(" "),
    };

    await prisma.priorAuthorization.upsert({
      where: { paNumber: c.paNumber },
      update: row,
      create: {
        paNumber: c.paNumber,
        prescriberNpi: null,
        requestedQuantity: 30,
        requestedDaysSupply: 30,
        ...row,
      },
    });
    written++;
  }

  const waiting = CASES.filter(
    (c) => needsStatement(c.kind) && c.statementAfterDays === null,
  ).length;
  console.log(
    `  ${written} exception, appeal and grievance filings ` +
      `(${waiting} waiting on a prescriber's supporting statement, so no deadline has started)`,
  );
}

function statusFor(c: ExceptionCase, decidedAt: Date | null): string {
  if (c.outcome) return c.outcome;
  if (decidedAt) return "InReview";
  return c.statementAfterDays === null && needsStatement(c.kind)
    ? "PendingInfo"
    : "InReview";
}

function needsStatement(kind: ExceptionCase["kind"]): boolean {
  return (
    kind === "FormularyException" ||
    kind === "StepException" ||
    kind === "QuantityException" ||
    kind === "TieringException"
  );
}

/** Names are stored with the licence appended, so compare the licence. */
function sameReviewer(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
