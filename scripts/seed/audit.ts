/**
 * Audit findings this engine should independently reproduce.
 *
 * Wisconsin commissions an annual independent PBM audit from PillarRx, which
 * re-prices 100% of claims and re-adjudicates 100% of them against a model of
 * the benefit plan. Those reports are public.
 *
 * That makes them the strongest available proof that this engine is right: a
 * correct adjudicator, pointed at a plan with known defects, should surface
 * the same categories of defect the auditor found. Each finding below is
 * paired with a detection rule that runs against our claim set, and the /proof
 * page reports whether the rule fired.
 */

import type { PrismaClient } from "../../src/generated/prisma/index.js";

export interface AuditFindingDef {
  id: string;
  title: string;
  auditYear: number;
  publishedFinding: string;
  detectionRule: string;
  scenarioTag: string;
  expectedOutcome: string;
  sourceDocumentId: string;
}

export const AUDIT_FINDINGS: AuditFindingDef[] = [
  {
    id: "finding-quantity-limit",
    title: "Quantity limit not enforced at point of sale",
    auditYear: 2025,
    publishedFinding:
      "The auditor's re-adjudication identified claims that paid above the formulary quantity limit, where the plan's own published limit should have rejected or cut back the fill. Quantity limit logic is one of the most common places a claims system and a benefit document drift apart, because the limit lives in a PDF and the edit lives in a configuration table.",
    detectionRule:
      "For every paid claim whose formulary entry carries a quantity limit, recompute quantity per day and compare against the published limit. Any paid claim exceeding it is a defect.",
    scenarioTag: "audit-quantity-limit",
    expectedOutcome:
      "The engine rejects with NCPDP 76 (Plan Limitations Exceeded) and cites the formulary line carrying the limit.",
    sourceDocumentId: "pillarrx-audit-2025",
  },
  {
    id: "finding-ltc-classification",
    title: "Long term care claims priced as retail",
    auditYear: 2025,
    publishedFinding:
      "Claims originating from long term care pharmacies were not consistently identified as such. Exhibit C excludes long term care from the retail network discount guarantees, so misclassifying them pulls non-qualifying claims into the guarantee calculation and distorts measured performance in both directions.",
    detectionRule:
      "Flag any claim from a pharmacy typed LTC that was included in the discount guarantee population.",
    scenarioTag: "audit-ltc-classification",
    expectedOutcome:
      "The engine marks the claim excluded from the discount guarantee and names long term care as the reason, citing the Exhibit C exclusion footnote.",
    sourceDocumentId: "pillarrx-audit-2025",
  },
  {
    id: "finding-channel-misassignment",
    title: "Day supply channel boundary applied incorrectly",
    auditYear: 2024,
    publishedFinding:
      "Exhibit C defines retail as 1 to 83 days supply and retail 90 as 84 or more. Claims sitting near that boundary were found priced against the wrong rate table, which changes both the AWP discount and the dispensing fee.",
    detectionRule:
      "For each paid claim, recompute the channel from days supply and the contract's boundary, and compare against the channel the claim was priced under.",
    scenarioTag: "audit-channel-boundary",
    expectedOutcome:
      "The engine derives the channel from days supply on every claim and records the boundary rule it applied, so a mismatch is impossible to introduce silently.",
    sourceDocumentId: "etf-audit-memo-2024",
  },
  {
    id: "finding-dispensing-fee",
    title: "Dispensing fee paid above the contracted amount",
    auditYear: 2025,
    publishedFinding:
      "The audit identified dispensing fees paid at amounts other than the contracted rate for the channel. A dispensing fee variance is individually small and collectively material: at roughly two million commercial claims a year, a ten cent error is $200,000.",
    detectionRule:
      "For every paid claim, compare the dispensing fee paid against the Exhibit C rate for that channel and drug class.",
    scenarioTag: "audit-dispensing-fee",
    expectedOutcome:
      "The engine reads the dispensing fee from the rate row it cites, so the paid fee and the contracted fee are the same value by construction.",
    sourceDocumentId: "pillarrx-audit-2025",
  },
  {
    id: "finding-passthrough-integrity",
    title: "Amount billed to the plan exceeds amount paid to the pharmacy",
    auditYear: 2025,
    publishedFinding:
      "A pass-through contract promises the plan is billed exactly what the pharmacy is paid. Verifying that promise is the single most valuable thing an audit of a pass-through PBM can do, and it requires seeing both sides of every claim.",
    detectionRule:
      "For every paid claim under a pass-through contract, assert that total billed equals total allowed. Any non-zero difference is spread.",
    scenarioTag: "audit-passthrough",
    expectedOutcome:
      "Zero claims with a non-zero difference. The engine prices the pharmacy side and the client side from the same rate row.",
    sourceDocumentId: "pillarrx-audit-2025",
  },
];

export async function seedAuditFindings(prisma: PrismaClient) {
  for (const f of AUDIT_FINDINGS) {
    await prisma.auditFinding.upsert({
      where: { id: f.id },
      create: {
        id: f.id,
        title: f.title,
        auditor: "PillarRx Consulting",
        auditYear: f.auditYear,
        publishedFinding: f.publishedFinding,
        detectionRule: f.detectionRule,
        scenarioTag: f.scenarioTag,
        expectedOutcome: f.expectedOutcome,
        sourceDocumentId: f.sourceDocumentId,
      },
      update: {
        publishedFinding: f.publishedFinding,
        detectionRule: f.detectionRule,
        expectedOutcome: f.expectedOutcome,
      },
    });
  }
}
