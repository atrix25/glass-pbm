import { describe, expect, it } from "vitest";
import {
  actionDefinition,
  allActionDefinitions,
} from "@/lib/agents/actions/registry";
import { CONSEQUENCE_CLASSES } from "@/lib/agents/actions/types";

const EXPECTED_ACTIONS = [
  "record-answer-set",
  "record-denial",
  "apply-benefit-change",
  "apply-correction",
  "terminate-coverage",
  "uphold-denial",
  "adjust-mac-price",
  "open-rebate-dispute",
  "post-guarantee-credit",
  "open-service-case",
  "handoff",
  "open-case",
  "refer-to-siu",
  "lock-in-member",
  "return-to-sponsor",
  "escalate",
  "close-benign",
];

describe("agent action registry", () => {
  it("fails closed for an unknown action", () => {
    expect(() => actionDefinition("unregistered-effect")).toThrow(
      "Unknown agent action",
    );
  });

  it("registers each action once with a schema and approver", () => {
    const definitions = allActionDefinitions();
    expect(definitions.map((item) => item.action).sort()).toEqual(
      EXPECTED_ACTIONS.sort(),
    );
    expect(new Set(definitions.map((item) => item.action)).size).toBe(
      definitions.length,
    );
    for (const definition of definitions) {
      expect(definition.description).not.toBe("");
      expect(definition.approverRoles.length).toBeGreaterThan(0);
      expect(definition.schema.safeParse(undefined).success).toBe(false);
    }
  });

  it("uses only typed consequence classes", () => {
    const allowed = new Set<string>(CONSEQUENCE_CLASSES);
    for (const definition of allActionDefinitions()) {
      expect(
        definition.consequences.every((item) => allowed.has(item)),
        definition.action,
      ).toBe(true);
    }
  });

  it("requires people for denials, money, and contract changes", () => {
    for (const action of [
      "record-denial",
      "apply-benefit-change",
      "uphold-denial",
      "adjust-mac-price",
      "open-rebate-dispute",
      "post-guarantee-credit",
      "refer-to-siu",
      "lock-in-member",
    ]) {
      const definition = actionDefinition(action);
      expect(definition.humanRequired, action).toBe(true);
      expect(definition.approverRoles, action).not.toContain("system");
    }
  });

  it("accepts the exact payload contracts used by the agent fleet", () => {
    expect(
      actionDefinition("record-answer-set").schema.safeParse({
        answers: { diagnosis: true },
        condition: "condition",
        specialty: "specialty",
        path: [{ step: 1 }],
      }).success,
    ).toBe(true);
    expect(
      actionDefinition("apply-correction").schema.safeParse({
        patch: { relationshipCode: "18" },
        rejectCode: "E07",
      }).success,
    ).toBe(true);
    expect(
      actionDefinition("adjust-mac-price").schema.safeParse({
        letter: "Reviewed response",
        revisedUnitPrice: 0.12345,
      }).success,
    ).toBe(true);
    expect(
      actionDefinition("post-guarantee-credit").schema.safeParse({
        guaranteeId: "pa-standard",
        period: "2026-01",
        amountCents: 10_000,
        rationale: "Deterministic scorecard result.",
      }).success,
    ).toBe(true);
  });
});
