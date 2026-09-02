/**
 * Plan-aware cost-share copy for the member agent.
 *
 * HDHP members must not be told the post-deductible schedule is what they pay
 * today, and must not hear IYC's $600 Rx OOP limit when theirs is $2,500.
 */

import { describe, expect, it } from "vitest";
import {
  describeLevelCostShare,
  prescriptionLimitLabel,
} from "@/lib/agent/cost-share-copy";
import { compose, type ToolRun } from "@/lib/agent/compose";
import type { ToolResult } from "@/lib/agent/tools";
import { HDHP_PLAN, PLAN } from "./fixtures";

const IYC: { deductibleIndividualCents: number; rxOopLimitIndividualCents: number } = {
  deductibleIndividualCents: PLAN.deductibleIndividual,
  rxOopLimitIndividualCents: PLAN.rxOopLimitIndividual,
};

const HDHP: { deductibleIndividualCents: number; rxOopLimitIndividualCents: number } = {
  deductibleIndividualCents: HDHP_PLAN.deductibleIndividual,
  rxOopLimitIndividualCents: HDHP_PLAN.rxOopLimitIndividual,
};

describe("describeLevelCostShare", () => {
  it("keeps the bare schedule for IYC (no deductible)", () => {
    expect(describeLevelCostShare("1", IYC)).toBe("$5 copay");
    expect(describeLevelCostShare("4", IYC)).toContain("$50 copay");
  });

  it("names the HDHP deductible before the schedule", () => {
    expect(describeLevelCostShare("1", HDHP)).toBe(
      "after meeting your $1,700.00 deductible, $5 copay",
    );
    expect(describeLevelCostShare("4", HDHP)).toMatch(
      /^after meeting your \$1,700\.00 deductible, \$50 copay/,
    );
  });

  it("does not put preventive drugs behind the deductible", () => {
    expect(describeLevelCostShare("$0", HDHP)).toBe(
      "no cost share, covered in full",
    );
  });

  it("falls back to the bare schedule when no plan context is available", () => {
    expect(describeLevelCostShare("2", null)).toBe(
      "20% coinsurance, $50 maximum per fill",
    );
  });
});

describe("prescriptionLimitLabel", () => {
  it("uses the enrolled plan's Rx OOP limit", () => {
    expect(prescriptionLimitLabel(IYC)).toBe("$600.00");
    expect(prescriptionLimitLabel(HDHP)).toBe("$2,500.00");
  });

  it("defaults to the IYC $600 when the member plan is unknown", () => {
    expect(prescriptionLimitLabel(null)).toBe("$600.00");
  });
});

function coverageRun(data: Record<string, unknown>): ToolRun[] {
  const result: ToolResult = {
    data,
    citations: [],
    summary: "test",
  };
  return [
    {
      tool: "checkCoverage",
      args: { drugName: "Skyrizi", memberId: "mbr-hdhp" },
      because: "test",
      error: null,
      result,
    },
  ];
}

describe("compose coverage / cost-quote use the tool's plan limit", () => {
  it("does not hardcode $600 when checkCoverage returns the HDHP limit", () => {
    const runs = coverageRun({
      drug: "Skyrizi",
      onFormulary: true,
      benefitLevel: "4",
      costShare:
        "after meeting your $1,700.00 deductible, $50 copay, and it must be filled at Lumicera or UW Health Specialty Pharmacy",
      prescriptionOutOfPocketLimit: "$2,500.00",
      countsTowardPrescriptionLimit: true,
      priorAuthorizationRequired: false,
      specialtyPharmacyRequired: true,
    });
    const answer = compose("Is Skyrizi covered?", "coverage", runs);
    const text = answer.paragraphs.join(" ");
    expect(text).toContain("$2,500.00");
    expect(text).toContain("after meeting your $1,700.00 deductible");
    expect(text).not.toContain("$600");
  });

  it("still names the IYC $600 limit when that is what the tool returned", () => {
    const runs = coverageRun({
      drug: "Lisinopril",
      onFormulary: true,
      benefitLevel: "1",
      costShare: "$5 copay",
      prescriptionOutOfPocketLimit: "$600.00",
      countsTowardPrescriptionLimit: true,
    });
    const answer = compose("Is lisinopril covered?", "coverage", runs);
    expect(answer.paragraphs.join(" ")).toContain("$600.00");
  });
});
