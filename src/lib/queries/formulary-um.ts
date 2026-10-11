/**
 * Formulary utilization management for sponsor analytics.
 *
 * Joins YTD spend (from the daily drug rollup) to the published Wisconsin
 * formulary flags — step therapy, PA, quantity limits, channel rules — so a
 * benefits director can see what already governs the expensive drugs.
 */

import { prisma } from "@/lib/db";
import type { SimulationClock } from "@/lib/clock";
import { getTopDrugs } from "@/lib/queries/sponsor";

const FORMULARY_ID = "navitus-etf-2026";

export interface DrugUmRow {
  drugId: string;
  name: string;
  therapeuticClass: string | null;
  isSpecialty: boolean;
  claims: number;
  billedCents: number;
  level: string;
  specialCode: string | null;
  requiresPA: boolean;
  requiresStep: boolean;
  hasQuantityLimit: boolean;
  diagnosisRestricted: boolean;
  specialistRestricted: boolean;
  mandatorySpecialty: boolean;
  limitedDistribution: boolean;
  criteriaTreeName: string | null;
  qlSummary: string | null;
  /** Plain-language list of active UM / prioritization rules on this product. */
  prioritizations: string[];
}

export interface HighCostDrugUmResult {
  asOf: string;
  drugCount: number;
  withStepTherapy: number;
  withPriorAuth: number;
  withQuantityLimit: number;
  drugs: DrugUmRow[];
}

function qlSummary(entry: {
  qlQuantity: number | null;
  qlDays: number | null;
  qlUnit: string | null;
  qlRawText: string | null;
}): string | null {
  if (entry.qlRawText) return entry.qlRawText;
  if (entry.qlQuantity == null) return null;
  const unit = entry.qlUnit ?? "units";
  if (entry.qlDays) {
    return `${entry.qlQuantity} ${unit} per ${entry.qlDays} days`;
  }
  return `${entry.qlQuantity} ${unit} per fill`;
}

function prioritizationsFor(entry: {
  level: string;
  requiresPA: boolean;
  requiresStep: boolean;
  hasQuantityLimit: boolean;
  diagnosisRestricted: boolean;
  specialistRestricted: boolean;
  mandatorySpecialty: boolean;
  limitedDistribution: boolean;
  qlSummary: string | null;
  criteriaTreeName: string | null;
}): string[] {
  const out: string[] = [`Level ${entry.level} cost share`];
  if (entry.requiresPA) {
    out.push(
      entry.criteriaTreeName
        ? `Prior authorization (${entry.criteriaTreeName})`
        : "Prior authorization",
    );
  }
  if (entry.requiresStep) out.push("Step therapy");
  if (entry.hasQuantityLimit && entry.qlSummary) {
    out.push(`Quantity limit: ${entry.qlSummary}`);
  } else if (entry.hasQuantityLimit) {
    out.push("Quantity limit");
  }
  if (entry.diagnosisRestricted) out.push("Diagnosis restricted");
  if (entry.specialistRestricted) out.push("Specialist prescriber required");
  if (entry.mandatorySpecialty) out.push("Mandatory specialty pharmacy");
  if (entry.limitedDistribution) out.push("Limited distribution");
  return out;
}

/** Top drugs by YTD billed amount with formulary UM flags from the published list. */
export async function getHighCostDrugUtilizationManagement(
  clock: SimulationClock,
  limit = 15,
): Promise<HighCostDrugUmResult> {
  const top = await getTopDrugs(clock, limit);
  if (top.length === 0) {
    return {
      asOf: clock.today.toISOString().slice(0, 10),
      drugCount: 0,
      withStepTherapy: 0,
      withPriorAuth: 0,
      withQuantityLimit: 0,
      drugs: [],
    };
  }

  const entries = await prisma.formularyEntry.findMany({
    where: {
      formularyId: FORMULARY_ID,
      drugId: { in: top.map((d) => d.drugId) },
    },
    include: {
      criteriaTree: { select: { name: true } },
    },
  });
  const byDrug = new Map(entries.map((e) => [e.drugId, e]));

  const drugs: DrugUmRow[] = top.map((d) => {
    const e = byDrug.get(d.drugId);
    const ql = e
      ? qlSummary(e)
      : null;
    const criteriaTreeName = e?.criteriaTree?.name ?? null;
    const row: DrugUmRow = {
      drugId: d.drugId,
      name: d.name,
      therapeuticClass: d.therapeuticClass,
      isSpecialty: d.isSpecialty,
      claims: d.claims,
      billedCents: d.billedCents,
      level: e?.level ?? "—",
      specialCode: e?.specialCode ?? null,
      requiresPA: e?.requiresPA ?? false,
      requiresStep: e?.requiresStep ?? false,
      hasQuantityLimit: e?.hasQuantityLimit ?? false,
      diagnosisRestricted: e?.diagnosisRestricted ?? false,
      specialistRestricted: e?.specialistRestricted ?? false,
      mandatorySpecialty: e?.mandatorySpecialty ?? false,
      limitedDistribution: e?.limitedDistribution ?? false,
      criteriaTreeName,
      qlSummary: ql,
      prioritizations: e
        ? prioritizationsFor({
            level: e.level,
            requiresPA: e.requiresPA,
            requiresStep: e.requiresStep,
            hasQuantityLimit: e.hasQuantityLimit,
            diagnosisRestricted: e.diagnosisRestricted,
            specialistRestricted: e.specialistRestricted,
            mandatorySpecialty: e.mandatorySpecialty,
            limitedDistribution: e.limitedDistribution,
            qlSummary: ql,
            criteriaTreeName,
          })
        : ["Not on the published formulary index"],
    };
    return row;
  });

  return {
    asOf: clock.today.toISOString().slice(0, 10),
    drugCount: drugs.length,
    withStepTherapy: drugs.filter((d) => d.requiresStep).length,
    withPriorAuth: drugs.filter((d) => d.requiresPA).length,
    withQuantityLimit: drugs.filter((d) => d.hasQuantityLimit).length,
    drugs,
  };
}

export type UmSearchFlag = "step" | "pa" | "ql" | "specialty" | "any";

export interface FormularyUmSearchRow {
  drugId: string;
  name: string;
  level: string;
  specialCode: string | null;
  requiresPA: boolean;
  requiresStep: boolean;
  hasQuantityLimit: boolean;
  prioritizations: string[];
}

export interface FormularyUmSearchResult {
  asOf: string;
  flag: UmSearchFlag;
  totalMatching: number;
  returned: number;
  drugs: FormularyUmSearchRow[];
}

function umWhereForFlag(flag: UmSearchFlag) {
  const base = { formularyId: FORMULARY_ID };
  switch (flag) {
    case "step":
      return { ...base, requiresStep: true };
    case "pa":
      return { ...base, requiresPA: true };
    case "ql":
      return { ...base, hasQuantityLimit: true };
    case "specialty":
      return { ...base, mandatorySpecialty: true };
    case "any":
      return {
        ...base,
        OR: [
          { requiresStep: true },
          { requiresPA: true },
          { hasQuantityLimit: true },
          { diagnosisRestricted: true },
          { specialistRestricted: true },
          { mandatorySpecialty: true },
          { limitedDistribution: true },
        ],
      };
  }
}

/** Search the published formulary index by UM flag, optionally filtering by drug name. */
export async function searchFormularyUtilizationManagement(
  clock: SimulationClock,
  opts: { flag?: UmSearchFlag; query?: string; limit?: number } = {},
): Promise<FormularyUmSearchResult> {
  const flag = opts.flag ?? "any";
  const limit = opts.limit ?? 25;
  const where = umWhereForFlag(flag);

  const [totalMatching, entries] = await Promise.all([
    prisma.formularyEntry.count({ where }),
    prisma.formularyEntry.findMany({
      where,
      include: {
        drug: { select: { id: true, name: true } },
        criteriaTree: { select: { name: true } },
      },
      orderBy: { drug: { name: "asc" } },
      take: opts.query ? 500 : limit,
    }),
  ]);

  let rows = entries;
  if (opts.query?.trim()) {
    const q = opts.query.trim().toLowerCase();
    rows = rows.filter((e) => e.drug.name.toLowerCase().includes(q));
  }
  rows = rows.slice(0, limit);

  const drugs: FormularyUmSearchRow[] = rows.map((e) => {
    const ql = qlSummary(e);
    const criteriaTreeName = e.criteriaTree?.name ?? null;
    return {
      drugId: e.drugId,
      name: e.drug.name,
      level: e.level,
      specialCode: e.specialCode,
      requiresPA: e.requiresPA,
      requiresStep: e.requiresStep,
      hasQuantityLimit: e.hasQuantityLimit,
      prioritizations: prioritizationsFor({
        level: e.level,
        requiresPA: e.requiresPA,
        requiresStep: e.requiresStep,
        hasQuantityLimit: e.hasQuantityLimit,
        diagnosisRestricted: e.diagnosisRestricted,
        specialistRestricted: e.specialistRestricted,
        mandatorySpecialty: e.mandatorySpecialty,
        limitedDistribution: e.limitedDistribution,
        qlSummary: ql,
        criteriaTreeName,
      }),
    };
  });

  return {
    asOf: clock.today.toISOString().slice(0, 10),
    flag,
    totalMatching,
    returned: drugs.length,
    drugs,
  };
}
