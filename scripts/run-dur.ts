/**
 * Runs drug utilisation review retrospectively over the whole book.
 *
 * Concurrent DUR normally happens at the point of sale, one fill at a time,
 * against whatever the member already has active. Running it backwards over a
 * year of claims answers a different and more uncomfortable question: how many
 * of these conflicts went out the door. The point-of-sale path uses the same
 * rules, so the two agree by construction.
 *
 *   npx tsx scripts/run-dur.ts
 */

import { prisma } from "../src/lib/db.js";
import {
  INTERACTION_RULES,
  matcherSql,
} from "../src/lib/clinical/interactions.js";
import { MME_THRESHOLDS } from "../src/lib/clinical/opioids.js";

const DAY_MS = 86_400_000;

/**
 * Classes where two concurrent products is a real finding rather than normal
 * practice. Topicals and ophthalmics are left out: a member on three different
 * creams is not a safety signal, and including them would bury the ones that
 * are.
 */
/**
 * A month of genuine overlap, not a few days.
 *
 * Cross-tapering one antidepressant onto another is good practice, and so is
 * finishing a bottle while starting its replacement. Both look like
 * duplication for a week or two. Requiring thirty days of concurrent supply
 * from two prescribers who are not the same person leaves the cases where
 * nobody appears to be holding the whole picture.
 */
const DUPLICATION_MIN_OVERLAP_DAYS = 30;

const DUPLICATION_CLASSES = [
  "ANALGESICS - OPIOID",
  "ANTIDEPRESSANTS",
  "ANTIPSYCHOTICS/ANTIMANIC AGENTS",
  "ANTIANXIETY AGENTS",
  "HYPNOTICS/SEDATIVES/SLEEP DISORDER AGENTS",
  "ANTICONVULSANTS",
  "ANTIHYPERLIPIDEMICS",
  "ULCER DRUGS",
  "ADHD/ANTI-NARCOLEPSY/ANTI-OBESITY/A NOREXIANTS",
  "ANTICOAGULANTS",
];

interface AlertRow {
  id: string;
  memberId: string;
  reasonCode: string;
  severityIndex: string;
  severity: string;
  claimId: string;
  drugId: string;
  relatedClaimId: string | null;
  relatedDrugId: string | null;
  dateOfService: Date;
  overlapDays: number;
  observedMme: number | null;
  message: string;
  ruleId: string;
  sourceId: string | null;
}

async function main() {
  const started = Date.now();
  await prisma.durAlert.deleteMany({});

  const alerts: AlertRow[] = [];
  let seq = 0;
  const nextId = () => `dur-${String(++seq).padStart(8, "0")}`;

  // --- Drug-drug interactions ---------------------------------------------
  console.log("Screening interactions...");
  for (const rule of INTERACTION_RULES) {
    const sql = `
      WITH sideA AS (
        SELECT c.id, c.memberId, c.drugId, c.dateOfService, c.daysSupply,
               c.prescriberNpi, d.name AS drugName
        FROM Claim c JOIN Drug d ON d.id = c.drugId
        WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
          AND c.daysSupply > 0 AND ${matcherSql(rule.a, "d")}
      ),
      sideB AS (
        SELECT c.id, c.memberId, c.drugId, c.dateOfService, c.daysSupply,
               c.prescriberNpi, d.name AS drugName
        FROM Claim c JOIN Drug d ON d.id = c.drugId
        WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
          AND c.daysSupply > 0 AND ${matcherSql(rule.b, "d")}
      )
      SELECT
        a.id AS aId, b.id AS bId, a.memberId AS memberId,
        a.drugId AS aDrug, b.drugId AS bDrug,
        a.drugName AS aName, b.drugName AS bName,
        CAST(a.dateOfService AS REAL) AS aDos, CAST(b.dateOfService AS REAL) AS bDos,
        a.prescriberNpi AS aPx, b.prescriberNpi AS bPx,
        CAST(MIN(a.dateOfService + a.daysSupply * ${DAY_MS},
                 b.dateOfService + b.daysSupply * ${DAY_MS})
             - MAX(a.dateOfService, b.dateOfService) AS REAL) AS overlapMs
      FROM sideA a
      JOIN sideB b ON b.memberId = a.memberId AND b.id <> a.id
      WHERE a.dateOfService < b.dateOfService + b.daysSupply * ${DAY_MS}
        AND b.dateOfService < a.dateOfService + a.daysSupply * ${DAY_MS}
    `;

    const rows = await prisma.$queryRawUnsafe<
      Array<{
        aId: string;
        bId: string;
        memberId: string;
        aDrug: string;
        bDrug: string;
        aName: string;
        bName: string;
        aDos: number;
        bDos: number;
        aPx: string | null;
        bPx: string | null;
        overlapMs: number;
      }>
    >(sql);

    // One alert per triggering fill: the later of the two is the one that
    // would have hit the alert at the counter. Where a member has several
    // qualifying partners, keep the longest overlap.
    const best = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const later = r.aDos >= r.bDos ? r.aId : r.bId;
      const key = `${rule.id}|${later}`;
      const prior = best.get(key);
      if (!prior || r.overlapMs > prior.overlapMs) best.set(key, r);
    }

    for (const [key, r] of best) {
      const triggerIsA = key.endsWith(`|${r.aId}`);
      const trigger = triggerIsA
        ? { id: r.aId, drug: r.aDrug, name: r.aName, dos: r.aDos, px: r.aPx }
        : { id: r.bId, drug: r.bDrug, name: r.bName, dos: r.bDos, px: r.bPx };
      const other = triggerIsA
        ? { id: r.bId, drug: r.bDrug, name: r.bName, px: r.bPx }
        : { id: r.aId, drug: r.aDrug, name: r.aName, px: r.aPx };

      const overlapDays = Math.max(1, Math.round(r.overlapMs / DAY_MS));
      const split =
        trigger.px && other.px && trigger.px !== other.px
          ? " Written by different prescribers."
          : "";

      alerts.push({
        id: nextId(),
        memberId: r.memberId,
        reasonCode: "DD",
        severityIndex: rule.severityIndex,
        severity: rule.severity,
        claimId: trigger.id,
        drugId: trigger.drug,
        relatedClaimId: other.id,
        relatedDrugId: other.drug,
        dateOfService: new Date(trigger.dos),
        overlapDays,
        observedMme: null,
        message: `${trigger.name} dispensed with ${other.name} active for ${overlapDays} days. ${rule.effect}${split}`,
        ruleId: rule.id,
        sourceId: null,
      });
    }
    console.log(`  ${rule.id.padEnd(34)} ${best.size.toLocaleString()}`);
  }

  // --- Therapeutic duplication --------------------------------------------
  console.log("Screening therapeutic duplication...");
  const classList = DUPLICATION_CLASSES.map(
    (c) => `'${c.replace(/'/g, "''")}'`,
  ).join(",");
  const dupRows = await prisma.$queryRawUnsafe<
    Array<{
      aId: string;
      bId: string;
      memberId: string;
      aDrug: string;
      bDrug: string;
      aName: string;
      bName: string;
      cls: string;
      aDos: number;
      bDos: number;
      aPx: string | null;
      bPx: string | null;
      overlapMs: number;
    }>
  >(`
    WITH t AS (
      SELECT c.id, c.memberId, c.drugId, c.dateOfService, c.daysSupply,
             c.prescriberNpi, d.name AS drugName, d.therapeuticClass AS cls,
             d.molecule AS molecule
      FROM Claim c JOIN Drug d ON d.id = c.drugId
      WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
        AND c.daysSupply > 0 AND d.therapeuticClass IN (${classList})
        AND d.molecule IS NOT NULL
    )
    SELECT a.id AS aId, b.id AS bId, a.memberId AS memberId,
           a.drugId AS aDrug, b.drugId AS bDrug,
           a.drugName AS aName, b.drugName AS bName, a.cls AS cls,
           CAST(a.dateOfService AS REAL) AS aDos, CAST(b.dateOfService AS REAL) AS bDos,
           a.prescriberNpi AS aPx, b.prescriberNpi AS bPx,
           CAST(MIN(a.dateOfService + a.daysSupply * ${DAY_MS},
                    b.dateOfService + b.daysSupply * ${DAY_MS})
                - MAX(a.dateOfService, b.dateOfService) AS REAL) AS overlapMs
    FROM t a
    JOIN t b ON b.memberId = a.memberId AND b.cls = a.cls
            AND b.molecule <> a.molecule AND b.id > a.id
    WHERE a.dateOfService < b.dateOfService + b.daysSupply * ${DAY_MS}
      AND b.dateOfService < a.dateOfService + a.daysSupply * ${DAY_MS}
      AND (MIN(a.dateOfService + a.daysSupply * ${DAY_MS},
               b.dateOfService + b.daysSupply * ${DAY_MS})
           - MAX(a.dateOfService, b.dateOfService)) >= ${DUPLICATION_MIN_OVERLAP_DAYS * DAY_MS}
      AND a.prescriberNpi IS NOT NULL AND b.prescriberNpi IS NOT NULL
      AND a.prescriberNpi <> b.prescriberNpi
  `);

  const dupBest = new Map<string, (typeof dupRows)[number]>();
  for (const r of dupRows) {
    const later = r.aDos >= r.bDos ? r.aId : r.bId;
    const prior = dupBest.get(later);
    if (!prior || r.overlapMs > prior.overlapMs) dupBest.set(later, r);
  }
  for (const [laterId, r] of dupBest) {
    const triggerIsA = laterId === r.aId;
    const trigger = triggerIsA
      ? { id: r.aId, drug: r.aDrug, name: r.aName, dos: r.aDos, px: r.aPx }
      : { id: r.bId, drug: r.bDrug, name: r.bName, dos: r.bDos, px: r.bPx };
    const other = triggerIsA
      ? { id: r.bId, drug: r.bDrug, name: r.bName, px: r.bPx }
      : { id: r.aId, drug: r.aDrug, name: r.aName, px: r.aPx };
    const overlapDays = Math.max(1, Math.round(r.overlapMs / DAY_MS));

    alerts.push({
      id: nextId(),
      memberId: r.memberId,
      reasonCode: "TD",
      severityIndex: "2",
      severity: "Moderate",
      claimId: trigger.id,
      drugId: trigger.drug,
      relatedClaimId: other.id,
      relatedDrugId: other.drug,
      dateOfService: new Date(trigger.dos),
      overlapDays,
      observedMme: null,
      message: `${trigger.name} overlaps ${other.name} for ${overlapDays} days. Both are ${titleCase(r.cls)}, written by two different prescribers, so neither may know about the other.`,
      ruleId: "dur.therapeutic-duplication",
      sourceId: null,
    });
  }
  console.log(`  ${dupBest.size.toLocaleString()} duplications`);

  // --- Cumulative opioid dose ---------------------------------------------
  console.log("Computing opioid dose...");
  const mmeRows = await prisma.$queryRawUnsafe<
    Array<{
      anchorId: string;
      memberId: string;
      drugId: string;
      day: number;
      totalMme: number;
      concurrent: number;
    }>
  >(`
    WITH mme AS (
      SELECT c.id, c.memberId, c.drugId, c.dateOfService, c.daysSupply,
             CASE WHEN o.isTransdermal = 1
                  THEN o.strengthMg * o.mmeFactor
                  ELSE c.quantityDispensed * o.strengthMg * o.mmeFactor / c.daysSupply
             END AS dmme
      FROM Claim c JOIN OpioidProduct o ON o.drugId = c.drugId
      WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
        AND o.convertible = 1 AND c.daysSupply > 0
    )
    SELECT s.id AS anchorId, s.memberId AS memberId, s.drugId AS drugId,
           CAST(s.dateOfService AS REAL) AS day,
           SUM(x.dmme) AS totalMme, COUNT(*) AS concurrent
    FROM mme s
    JOIN mme x ON x.memberId = s.memberId
      AND x.dateOfService <= s.dateOfService
      AND x.dateOfService + x.daysSupply * ${DAY_MS} > s.dateOfService
    GROUP BY s.id
    HAVING totalMme >= ${MME_THRESHOLDS.reassess}
  `);

  for (const r of mmeRows) {
    const high = r.totalMme >= MME_THRESHOLDS.avoidOrJustify;
    const concurrent = Number(r.concurrent);
    alerts.push({
      id: nextId(),
      memberId: r.memberId,
      reasonCode: "HD",
      severityIndex: high ? "1" : "2",
      severity: high ? "Major" : "Moderate",
      claimId: r.anchorId,
      drugId: r.drugId,
      relatedClaimId: null,
      relatedDrugId: null,
      dateOfService: new Date(r.day),
      overlapDays: 0,
      observedMme: Math.round(r.totalMme * 10) / 10,
      message: high
        ? `Total daily dose reaches ${Math.round(r.totalMme)} MME across ${concurrent} active opioid ${concurrent === 1 ? "fill" : "fills"}. The CDC advises against increasing to 90 MME or more per day without careful justification.`
        : `Total daily dose reaches ${Math.round(r.totalMme)} MME across ${concurrent} active opioid ${concurrent === 1 ? "fill" : "fills"}. The CDC advises reassessing benefits and risks at 50 MME per day.`,
      ruleId: high ? "dur.opioid-dose-90" : "dur.opioid-dose-50",
      sourceId: null,
    });
  }
  console.log(`  ${mmeRows.length.toLocaleString()} dose alerts`);

  console.log(`Writing ${alerts.length.toLocaleString()} alerts...`);
  for (let i = 0; i < alerts.length; i += 2000) {
    await prisma.durAlert.createMany({ data: alerts.slice(i, i + 2000) });
  }

  const byCode = await prisma.durAlert.groupBy({
    by: ["reasonCode", "severity"],
    _count: true,
  });
  console.log("\nAlerts by conflict code:");
  for (const g of byCode.sort((a, b) => b._count - a._count)) {
    console.log(
      `  ${g.reasonCode}  ${g.severity.padEnd(9)} ${g._count.toLocaleString()}`,
    );
  }
  const members = await prisma.durAlert.findMany({
    distinct: ["memberId"],
    select: { memberId: true },
  });
  console.log(`  ${members.length.toLocaleString()} distinct members affected`);
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bAnd\b/g, "and")
    .replace(/\bMisc\./g, "misc.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
