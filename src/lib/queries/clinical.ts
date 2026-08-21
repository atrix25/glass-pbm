import { prisma } from "@/lib/db";
import type { SimulationClock } from "@/lib/clock";
import { INTERACTION_RULES, type InteractionRule } from "@/lib/clinical/interactions";
import { MME_THRESHOLDS } from "@/lib/clinical/opioids";

export interface RuleResult {
  rule: InteractionRule;
  alerts: number;
  members: number;
  /** Paid claims screened on each side of the pair. */
  sideAFills: number;
  sideBFills: number;
}

export interface ClinicalOverview {
  claimsScreened: number;
  membersScreened: number;
  totalAlerts: number;
  majorAlerts: number;
  membersAffected: number;
  byCode: Array<{ code: string; label: string; alerts: number; members: number }>;
  interactions: RuleResult[];
  duplication: { alerts: number; members: number };
  dose: {
    atReassess: number;
    atCeiling: number;
    members: number;
    peakMme: number;
    convertibleProducts: number;
    excludedProducts: number;
  };
}

const CODE_LABELS: Record<string, string> = {
  DD: "Drug-drug interaction",
  TD: "Therapeutic duplication",
  HD: "High dose",
  ER: "Early refill",
};

export async function getClinicalOverview(
  clock: SimulationClock,
): Promise<ClinicalOverview> {
  const [screened, byCodeRows, ruleRows, dupRow, doseRows, products] =
    await Promise.all([
      prisma.$queryRaw<Array<{ claims: number; members: number }>>`
        SELECT COUNT(*) AS claims, COUNT(DISTINCT memberId) AS members
        FROM Claim
        WHERE responseStatus = 'P' AND transactionCode = 'B1'
          AND dateOfService <= ${clock.now}
      `,
      prisma.$queryRaw<
        Array<{ reasonCode: string; alerts: number; members: number }>
      >`
        SELECT reasonCode, COUNT(*) AS alerts, COUNT(DISTINCT memberId) AS members
        FROM DurAlert WHERE dateOfService <= ${clock.now}
        GROUP BY reasonCode
      `,
      prisma.$queryRaw<
        Array<{ ruleId: string; alerts: number; members: number }>
      >`
        SELECT ruleId, COUNT(*) AS alerts, COUNT(DISTINCT memberId) AS members
        FROM DurAlert WHERE reasonCode = 'DD' AND dateOfService <= ${clock.now}
        GROUP BY ruleId
      `,
      prisma.$queryRaw<Array<{ alerts: number; members: number }>>`
        SELECT COUNT(*) AS alerts, COUNT(DISTINCT memberId) AS members
        FROM DurAlert WHERE reasonCode = 'TD' AND dateOfService <= ${clock.now}
      `,
      prisma.$queryRaw<
        Array<{
          atReassess: number;
          atCeiling: number;
          members: number;
          peak: number;
        }>
      >`
        SELECT
          SUM(CASE WHEN observedMme >= ${MME_THRESHOLDS.reassess}
                    AND observedMme < ${MME_THRESHOLDS.avoidOrJustify} THEN 1 ELSE 0 END) AS atReassess,
          SUM(CASE WHEN observedMme >= ${MME_THRESHOLDS.avoidOrJustify} THEN 1 ELSE 0 END) AS atCeiling,
          COUNT(DISTINCT memberId) AS members,
          MAX(observedMme) AS peak
        FROM DurAlert WHERE reasonCode = 'HD' AND dateOfService <= ${clock.now}
      `,
      prisma.$queryRaw<Array<{ convertible: number; excluded: number }>>`
        SELECT SUM(CASE WHEN convertible = 1 THEN 1 ELSE 0 END) AS convertible,
               SUM(CASE WHEN convertible = 0 THEN 1 ELSE 0 END) AS excluded
        FROM OpioidProduct
      `,
    ]);

  // How many paid fills sat on each side of every rule, so a rule that found
  // nothing can be distinguished from a rule that had nothing to screen.
  const fillCounts = await ruleSideCounts(clock);

  const alertsByRule = new Map(
    ruleRows.map((r) => [r.ruleId, { alerts: Number(r.alerts), members: Number(r.members) }]),
  );

  const interactions: RuleResult[] = INTERACTION_RULES.map((rule) => ({
    rule,
    alerts: alertsByRule.get(rule.id)?.alerts ?? 0,
    members: alertsByRule.get(rule.id)?.members ?? 0,
    sideAFills: fillCounts.get(`${rule.id}|a`) ?? 0,
    sideBFills: fillCounts.get(`${rule.id}|b`) ?? 0,
  }));

  const totalAlerts = byCodeRows.reduce((s, r) => s + Number(r.alerts), 0);
  const major = await prisma.durAlert.count({
    where: { severity: "Major", dateOfService: { lte: clock.now } },
  });
  const affected = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(DISTINCT memberId) AS n FROM DurAlert
    WHERE dateOfService <= ${clock.now}
  `;

  const dose = doseRows[0];

  return {
    claimsScreened: Number(screened[0]?.claims ?? 0),
    membersScreened: Number(screened[0]?.members ?? 0),
    totalAlerts,
    majorAlerts: major,
    membersAffected: Number(affected[0]?.n ?? 0),
    byCode: byCodeRows
      .map((r) => ({
        code: r.reasonCode,
        label: CODE_LABELS[r.reasonCode] ?? r.reasonCode,
        alerts: Number(r.alerts),
        members: Number(r.members),
      }))
      .sort((a, b) => b.alerts - a.alerts),
    interactions,
    duplication: {
      alerts: Number(dupRow[0]?.alerts ?? 0),
      members: Number(dupRow[0]?.members ?? 0),
    },
    dose: {
      atReassess: Number(dose?.atReassess ?? 0),
      atCeiling: Number(dose?.atCeiling ?? 0),
      members: Number(dose?.members ?? 0),
      peakMme: Math.round(Number(dose?.peak ?? 0)),
      convertibleProducts: Number(products[0]?.convertible ?? 0),
      excludedProducts: Number(products[0]?.excluded ?? 0),
    },
  };
}

/**
 * Paid fills on each side of every interaction rule.
 *
 * Without this a rule reading zero is ambiguous, and the ambiguity matters: a
 * rule that screened forty thousand fills and found no conflict is a result,
 * while a rule whose drugs nobody filled is not.
 */
async function ruleSideCounts(
  clock: SimulationClock,
): Promise<Map<string, number>> {
  const { matcherSql } = await import("@/lib/clinical/interactions");
  const out = new Map<string, number>();

  for (const rule of INTERACTION_RULES) {
    for (const side of ["a", "b"] as const) {
      const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
        SELECT COUNT(*) AS n FROM Claim c JOIN Drug d ON d.id = c.drugId
        WHERE c.responseStatus = 'P' AND c.transactionCode = 'B1'
          AND c.dateOfService <= '${clock.now.toISOString()}'
          AND ${matcherSql(rule[side], "d")}
      `);
      out.set(`${rule.id}|${side}`, Number(rows[0]?.n ?? 0));
    }
  }
  return out;
}

export interface AlertListRow {
  id: string;
  memberId: string;
  memberName: string;
  reasonCode: string;
  severity: string;
  severityIndex: string;
  drugName: string;
  relatedDrugName: string | null;
  dateOfService: Date;
  overlapDays: number;
  observedMme: number | null;
  message: string;
  ruleId: string;
  claimId: string;
}

/**
 * The worst open conflicts, spread across conflict types.
 *
 * Ranking purely by dose fills the table with twenty rows of the same opioid
 * message, which reads as one finding repeated rather than a queue. Taking the
 * worst of each conflict code keeps every kind of problem visible.
 */
export async function listTopAlerts(
  clock: SimulationClock,
  limit = 25,
): Promise<AlertListRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      memberId: string;
      firstName: string;
      lastName: string;
      reasonCode: string;
      severity: string;
      severityIndex: string;
      drugName: string;
      relatedName: string | null;
      dateOfService: number;
      overlapDays: number;
      observedMme: number | null;
      message: string;
      ruleId: string;
      claimId: string;
    }>
  >`
    SELECT a.id, a.memberId, m.firstName, m.lastName, a.reasonCode, a.severity,
           a.severityIndex, d.name AS drugName, rd.name AS relatedName,
           a.dateOfService, a.overlapDays, a.observedMme, a.message, a.ruleId,
           a.claimId
    FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY ruleId
        ORDER BY COALESCE(observedMme, 0) DESC, overlapDays DESC, dateOfService DESC
      ) AS rankInRule
      FROM DurAlert
      WHERE severity = 'Major' AND dateOfService <= ${clock.now}
    ) a
    JOIN Member m ON m.id = a.memberId
    JOIN Drug d ON d.id = a.drugId
    LEFT JOIN Drug rd ON rd.id = a.relatedDrugId
    WHERE a.rankInRule <= 4
    ORDER BY a.severityIndex ASC, COALESCE(a.observedMme, 0) DESC,
             a.overlapDays DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    id: r.id,
    memberId: r.memberId,
    memberName: `${r.firstName} ${r.lastName}`,
    reasonCode: r.reasonCode,
    severity: r.severity,
    severityIndex: r.severityIndex,
    drugName: r.drugName,
    relatedDrugName: r.relatedName,
    dateOfService: new Date(Number(r.dateOfService)),
    overlapDays: r.overlapDays,
    observedMme: r.observedMme,
    message: r.message,
    ruleId: r.ruleId,
    claimId: r.claimId,
  }));
}
