/**
 * Builds the eligibility feed that put this membership here.
 *
 * A PBM does not decide who is covered. An employer's payroll system decides,
 * and tells the PBM on a schedule in ANSI X12 834, and everything downstream —
 * every paid claim, every rejected one, every dollar recovered later — is
 * downstream of whether that file was right and whether it arrived on time.
 * The book already has the answer: 103,000 eligibility spans. This script
 * reconstructs the traffic that produced them, so the membership has a
 * provenance rather than simply existing.
 *
 * The cadence is the ordinary one. A change file every Monday carrying only
 * what moved, and a full audit on the first Monday of the month restating the
 * whole population so both sides can find what has silently drifted apart.
 * The audit is not ceremony: it is how a plan discovers the terminations its
 * employer never sent, which is the same population the recovery worklist
 * bills for.
 *
 *   npx tsx scripts/build-eligibility-files.ts
 */

import { prisma } from "../src/lib/db.js";
import { Rng } from "./seed/population.js";
import { PLAN_YEAR } from "../src/lib/clock.js";

const SPONSOR_ID = "steel-potatoes";
const SENDER_ID = "STEELPOTATOES";
const RECEIVER_ID = "GLASSRX";
const DAY_MS = 86_400_000;

/** Defects a sponsor's payroll extract actually produces. */
const DEFECTS = [
  {
    code: "E03",
    reason:
      "Benefit end date on DTP*349 precedes the benefit begin date on DTP*348.",
    /** Corrupt the transaction so the reject is visible in the segments. */
    corrupt: (t: Draft) => ({
      ...t,
      terminationDate: t.effectiveDate
        ? new Date(t.effectiveDate.getTime() - 14 * DAY_MS)
        : t.terminationDate,
    }),
  },
  {
    code: "E04",
    reason:
      "Health coverage code in HD03 is not a benefit plan under contract ETG0013.",
    corrupt: (t: Draft) => ({ ...t, benefitPlanId: null }),
  },
  {
    code: "E05",
    reason: "Date of birth is absent from DMG02. The member cannot be matched.",
    corrupt: (t: Draft) => ({ ...t, memberId: null }),
  },
  {
    code: "E07",
    reason:
      "Individual relationship code in INS02 does not agree with the person code in REF*17.",
    corrupt: (t: Draft) => ({ ...t, relationshipCode: "19" }),
  },
];

/** Rejects that never get corrected, because the person does not exist. */
const ORPHAN_REASON = {
  code: "E08",
  reason:
    "No contract on file matches the subscriber identifier in REF*0F. The instruction was returned unapplied.",
};

interface Draft {
  maintenanceType: string;
  maintenanceReason: string | null;
  memberId: string | null;
  cardholderId: string;
  personCode: string;
  relationshipCode: string;
  memberName: string;
  benefitPlanId: string | null;
  coverageTier: string | null;
  effectiveDate: Date | null;
  terminationDate: Date | null;
}

function relationshipFor(code: string) {
  return code === "1" ? "18" : code === "2" ? "01" : "19";
}

/** Mondays of the plan year. */
function mondays(): Date[] {
  const out: Date[] = [];
  const cursor = new Date(Date.UTC(PLAN_YEAR, 0, 1));
  while (cursor.getUTCDay() !== 1) cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor.getUTCFullYear() === PLAN_YEAR) {
    out.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return out;
}

async function main() {
  console.log("Rebuilding the eligibility feed...");
  await prisma.eligibilityTransaction.deleteMany();
  await prisma.eligibilityFile.deleteMany();

  const rng = new Rng(8340);

  const spans = await prisma.eligibilitySpan.findMany({
    select: {
      id: true,
      memberId: true,
      benefitPlanId: true,
      coverageTier: true,
      effectiveDate: true,
      terminationDate: true,
      reportedTerminationDate: true,
      retroReportedAt: true,
      member: {
        select: {
          cardholderId: true,
          personCode: true,
          relationshipCode: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });
  console.log(`  ${spans.length.toLocaleString()} spans to account for`);

  const draftOf = (
    s: (typeof spans)[number],
    maintenanceType: string,
    reason: string | null,
  ): Draft => ({
    maintenanceType,
    maintenanceReason: reason,
    memberId: s.memberId,
    cardholderId: s.member.cardholderId,
    personCode: s.member.personCode,
    relationshipCode: relationshipFor(s.member.relationshipCode),
    memberName: `${s.member.lastName}, ${s.member.firstName}`,
    benefitPlanId: s.benefitPlanId,
    coverageTier: s.coverageTier,
    effectiveDate: s.effectiveDate,
    terminationDate: s.terminationDate,
  });

  // Every file, keyed by the Monday it covers plus the annual one.
  const files: Array<{
    id: string;
    fileType: string;
    createdAt: Date;
    receivedAt: Date;
    processedAt: Date;
    /** Lives restated. Only the audit carries the whole population. */
    restated: number;
    drafts: Draft[];
  }> = [];

  // --- The annual enrollment file -------------------------------------------
  /*
   * Open enrollment closes in the autumn and the whole population arrives at
   * once, before the year it covers. Every span effective on 1 January traces
   * to this file.
   */
  const yearStart = Date.UTC(PLAN_YEAR, 0, 1);
  const annual = {
    id: "elig-file-annual",
    fileType: "Annual enrollment",
    createdAt: new Date(Date.UTC(PLAN_YEAR - 1, 11, 12)),
    receivedAt: new Date(Date.UTC(PLAN_YEAR - 1, 11, 12, 18, 30)),
    processedAt: new Date(Date.UTC(PLAN_YEAR - 1, 11, 14)),
    restated: 0,
    drafts: [] as Draft[],
  };
  files.push(annual);

  const weeks = mondays();
  const weekly = weeks.map((monday, i) => ({
    id: `elig-file-w${String(i + 1).padStart(2, "0")}`,
    // The first Monday of each month is the audit; the rest carry changes.
    fileType: monday.getUTCDate() <= 7 ? "Full audit" : "Change",
    // Payroll cuts the file on Friday evening for a Monday delivery.
    createdAt: new Date(monday.getTime() - 3 * DAY_MS + 21 * 3_600_000),
    receivedAt: new Date(monday.getTime() + 6 * 3_600_000),
    processedAt: new Date(monday.getTime() + DAY_MS + 4 * 3_600_000),
    restated: 0,
    drafts: [] as Draft[],
  }));
  /*
   * The December roster is audited in the new year, because there is no
   * Monday left in the old one. Without it a termination reported in late
   * December would have no audit to have been found by, and the date the plan
   * learned would come from nowhere.
   */
  const trailingAudit = (() => {
    const monday = new Date(Date.UTC(PLAN_YEAR + 1, 0, 1));
    while (monday.getUTCDay() !== 1) monday.setUTCDate(monday.getUTCDate() + 1);
    return {
      id: "elig-file-w53",
      fileType: "Full audit",
      createdAt: new Date(monday.getTime() - 3 * DAY_MS + 21 * 3_600_000),
      receivedAt: new Date(monday.getTime() + 6 * 3_600_000),
      processedAt: new Date(monday.getTime() + DAY_MS + 4 * 3_600_000),
      restated: 0,
      drafts: [] as Draft[],
    };
  })();
  weekly.push(trailingAudit);
  files.push(...weekly);

  /** The file that would carry an event happening on `when`. */
  const fileFor = (when: Date) => {
    for (let i = weekly.length - 1; i >= 0; i--) {
      if (weekly[i].receivedAt.getTime() >= when.getTime()) continue;
      return weekly[Math.min(i + 1, weekly.length - 1)];
    }
    return weekly[0];
  };

  /** The next full audit on or after `when`. There is always one. */
  const auditFor = (when: Date) =>
    weekly.find(
      (f) =>
        f.fileType === "Full audit" &&
        f.receivedAt.getTime() >= when.getTime(),
    ) ?? trailingAudit;

  // --- Adds -----------------------------------------------------------------
  for (const s of spans) {
    if (s.effectiveDate.getTime() <= yearStart) {
      annual.drafts.push(draftOf(s, "021", "EC"));
    } else {
      // A mid-year hire reaches payroll before the coverage starts, usually.
      fileFor(s.effectiveDate).drafts.push(draftOf(s, "021", "AI"));
    }
  }
  annual.restated = annual.drafts.length;

  // --- Terminations ---------------------------------------------------------
  /*
   * A termination reported on time rides the next weekly change file. The ones
   * the employer never sent surface on a full audit instead, because the
   * member is simply absent from the restated roster, and the audit date
   * becomes the date the plan learned. Those spans already carry the date they
   * were reported; this aligns it with the file that reported it, so the
   * recovery worklist and the feed tell the same story.
   */
  const retroUpdates: Array<{ id: string; retroReportedAt: Date }> = [];
  for (const s of spans) {
    if (s.retroReportedAt && s.reportedTerminationDate) {
      const audit = auditFor(s.retroReportedAt);
      const draft = draftOf(s, "024", "07");
      draft.terminationDate = s.reportedTerminationDate;
      audit.drafts.push(draft);
      retroUpdates.push({ id: s.id, retroReportedAt: audit.processedAt });
      continue;
    }
    if (!s.terminationDate) continue;
    const draft = draftOf(s, "024", rng.bool(0.7) ? "08" : "07");
    fileFor(s.terminationDate).drafts.push(draft);
  }

  // --- Demographic changes --------------------------------------------------
  /*
   * Most of what an 834 carries changes nothing about coverage: a married
   * name, a new address, a corrected birth date. They are here because a feed
   * without them looks like a feed nobody uses.
   */
  const changeable = rng.sample(spans, 3_200);
  for (const s of changeable) {
    const draft = draftOf(s, "001", rng.pick(["25", "AI", "XN"]));
    fileFor(new Date(yearStart + rng.int(7, 350) * DAY_MS)).drafts.push(draft);
  }

  // --- Rejections -----------------------------------------------------------
  /*
   * Two kinds. A defective copy of an instruction that later applied — the
   * sponsor sent it wrong, got it back, and re-sent it correctly, which is why
   * the correction is already in the feed above. And instructions for people
   * who are not on any contract, which can never apply at all.
   */
  const rejects: Array<{
    file: (typeof weekly)[number];
    draft: Draft;
    code: string;
    reason: string;
    correctionOf: Draft | null;
    resolvedAt: Date | null;
    resolution: string | null;
  }> = [];

  const applied = weekly.flatMap((f) =>
    f.drafts.map((d) => ({ file: f, draft: d })),
  );
  for (const { file, draft } of rng.sample(applied, 900)) {
    const index = weekly.indexOf(file);
    if (index <= 0) continue;
    const defect = rng.pick(DEFECTS);
    rejects.push({
      file: weekly[index - 1],
      draft: defect.corrupt(draft),
      code: defect.code,
      reason: defect.reason,
      correctionOf: draft,
      // The correction is the instruction that later applied, so the closing
      // date is whenever that file was processed.
      resolvedAt: file.processedAt,
      resolution: "Corrected and re-sent",
    });
  }

  /*
   * Orphans cannot be corrected, because there is nobody to correct them to.
   * Somebody calls the employer, the employer says that person belongs to a
   * different subsidiary, and the instruction is withdrawn. Most close inside
   * a couple of months; a residue never does, which is what an eligibility
   * worklist looks like in every plan that has one.
   */
  for (let i = 0; i < 260; i++) {
    const file = rng.pick(weekly);
    const cardholderId = `W${String(rng.int(700_000_000, 799_999_999))}`;
    const worked = rng.bool(0.85);
    rejects.push({
      resolvedAt: worked
        ? new Date(file.processedAt.getTime() + rng.int(9, 64) * DAY_MS)
        : null,
      resolution: worked ? "Withdrawn by the sponsor" : null,
      file,
      draft: {
        maintenanceType: rng.bool(0.6) ? "021" : "024",
        maintenanceReason: "AI",
        memberId: null,
        cardholderId,
        personCode: rng.bool(0.7) ? "01" : "02",
        relationshipCode: rng.bool(0.7) ? "18" : "01",
        memberName: `${rng.pick(["HOLM", "BRENNAN", "OKAFOR", "SANDOVAL", "PETERSEN"])}, ${rng.pick(["J", "M", "A", "R"])}`,
        benefitPlanId: "wi-iyc-2026",
        coverageTier: "Individual",
        effectiveDate: new Date(file.receivedAt.getTime() + 7 * DAY_MS),
        terminationDate: null,
      },
      code: ORPHAN_REASON.code,
      reason: ORPHAN_REASON.reason,
      correctionOf: null,
    });
  }

  // --- Persist --------------------------------------------------------------
  const transactionRows: Array<{
    id: string;
    fileId: string;
    maintenanceType: string;
    maintenanceReason: string | null;
    memberId: string | null;
    cardholderId: string;
    personCode: string;
    relationshipCode: string;
    memberName: string;
    benefitPlanId: string | null;
    coverageTier: string | null;
    effectiveDate: Date | null;
    terminationDate: Date | null;
    status: string;
    rejectCode: string | null;
    rejectReason: string | null;
    correctedById: string | null;
    resolvedAt: Date | null;
    resolution: string | null;
  }> = [];

  // Applied transactions first, so a rejection can name the one that fixed it.
  const idOfDraft = new Map<Draft, string>();
  let seq = 0;
  for (const file of files) {
    for (const draft of file.drafts) {
      const id = `elig-tx-${String(++seq).padStart(7, "0")}`;
      idOfDraft.set(draft, id);
      transactionRows.push({
        id,
        fileId: file.id,
        ...draft,
        status: "Applied",
        rejectCode: null,
        rejectReason: null,
        correctedById: null,
        resolvedAt: null,
        resolution: null,
      });
    }
  }
  for (const r of rejects) {
    transactionRows.push({
      id: `elig-tx-${String(++seq).padStart(7, "0")}`,
      fileId: r.file.id,
      ...r.draft,
      status: "Rejected",
      rejectCode: r.code,
      rejectReason: r.reason,
      correctedById: r.correctionOf
        ? (idOfDraft.get(r.correctionOf) ?? null)
        : null,
      resolvedAt: r.resolvedAt,
      resolution: r.resolution,
    });
  }

  const rejectsByFile = new Map<string, number>();
  for (const r of rejects) {
    rejectsByFile.set(r.file.id, (rejectsByFile.get(r.file.id) ?? 0) + 1);
  }

  // An audit restates whoever was covered on the day it was cut.
  const restated = new Map<string, number>();
  for (const f of files) {
    if (f.fileType === "Change") continue;
    restated.set(f.id, f.restated || (await countLives(f.receivedAt)));
  }

  await prisma.eligibilityFile.createMany({
    data: files.map((f) => {
      const adds = f.drafts.filter((d) => d.maintenanceType === "021").length;
      const changes = f.drafts.filter((d) => d.maintenanceType === "001").length;
      const terms = f.drafts.filter((d) => d.maintenanceType === "024").length;
      const rejected = rejectsByFile.get(f.id) ?? 0;
      return {
        id: f.id,
        sponsorId: SPONSOR_ID,
        controlNumber: controlNumber(f.id),
        senderId: SENDER_ID,
        receiverId: RECEIVER_ID,
        fileType: f.fileType,
        createdAt: f.createdAt,
        receivedAt: f.receivedAt,
        processedAt: f.processedAt,
        /*
         * A change file carries what moved. An audit restates the whole
         * population, so its record count is the roster even though only the
         * instructions that changed something are retained.
         */
        recordCount:
          f.fileType === "Change"
            ? adds + changes + terms + rejected
            : (restated.get(f.id) ?? 0),
        addCount: adds,
        changeCount: changes,
        termCount: terms,
        rejectCount: rejected,
      };
    }),
  });

  for (let i = 0; i < transactionRows.length; i += 5_000) {
    await prisma.eligibilityTransaction.createMany({
      data: transactionRows.slice(i, i + 5_000),
    });
  }

  for (const u of retroUpdates) {
    await prisma.eligibilitySpan.update({
      where: { id: u.id },
      data: { retroReportedAt: u.retroReportedAt },
    });
  }

  console.log(
    `  ${files.length} files, ${transactionRows.length.toLocaleString()} transactions, ` +
      `${rejects.length} rejected, ${retroUpdates.length} terminations found by audit`,
  );
}

function controlNumber(fileId: string): string {
  let hash = 0;
  for (const ch of fileId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return String(100_000_000 + (hash % 899_999_999));
}

async function countLives(asOf: Date): Promise<number> {
  return prisma.eligibilitySpan.count({
    where: {
      effectiveDate: { lte: asOf },
      OR: [{ terminationDate: null }, { terminationDate: { gte: asOf } }],
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
