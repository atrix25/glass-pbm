import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REQUIRED_DOMAINS = [
  "commercial-client",
  "implementation-eligibility",
  "claims-benefit",
  "clinical-um",
  "formulary",
  "pharmacy-network",
  "pricing-mac",
  "manufacturer-rebates",
  "finance-settlement",
  "stakeholder-service",
  "data-analytics",
  "compliance-security",
  "quality-resilience",
] as const;

const CURRENT_AGENTS = [
  "pa-intake",
  "plan-design",
  "integrity-triage",
  "eligibility-resolver",
  "appeal-drafter",
  "member-service",
  "data-agent",
  "account-management",
  "rebate-protection",
] as const;

const EXECUTION_MODES = new Set([
  "deterministic",
  "model",
  "hybrid",
  "human-authority",
]);
const RISK_TIERS = new Set(["low", "moderate", "high", "critical"]);
const AUTONOMY_LEVELS = new Set([
  "observe",
  "recommend",
  "act-reversible",
  "act-with-review",
  "human-only",
]);
const CONSEQUENCE_CLASSES = new Set([
  "care",
  "coverage",
  "money",
  "contract",
  "external_communication",
  "phi_disclosure",
  "credentialing",
  "legal_compliance",
  "security",
]);

type Tool = { name: string; access: string; scope: string };
type Metric = { name: string; target: string };
type Process = {
  id: string;
  name: string;
  domain: string;
  description: string;
  trigger: { type: string; event: string };
  owner: string;
  accountableAuthority: string;
  inputs: string[];
  outputs: string[];
  sourceOfTruth: string[];
  executionMode: string;
  authoritativeCalculation: {
    required: boolean;
    authority: string;
    system: string | null;
  };
  tools: Tool[];
  evidence: string[];
  consequenceClasses: string[];
  riskTier: string;
  autonomy: string;
  approval: {
    required: boolean;
    authority: string | null;
    conditions: string[];
  };
  sla: { target: string; escalation: string };
  controls: string[];
  metrics: Metric[];
  failureHandling: {
    fallback: string;
    escalation: string;
    recovery: string;
  };
  downstreamEvents: string[];
  currentGlassAgents: string[];
};

type Catalog = {
  schemaVersion: string;
  catalogId: string;
  domainIds: string[];
  currentGlassAgentIds: string[];
  domains: Array<{
    id: string;
    name: string;
    commercialPurpose: string;
    processes: Process[];
  }>;
};

const catalogPath = fileURLToPath(
  new URL("../docs/ai-native-pbm/agent-catalog.json", import.meta.url),
);
const schemaPath = fileURLToPath(
  new URL("../docs/ai-native-pbm/agent-catalog.schema.json", import.meta.url),
);
const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as Catalog;
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
  $schema: string;
  properties: { domains: { minItems: number; maxItems: number } };
  $defs: {
    process: {
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, unknown> & {
        executionMode: { enum: string[] };
        consequenceClasses: { items: { enum: string[] } };
      };
    };
  };
};
const processes = catalog.domains.flatMap((domain) => domain.processes);

function expectNonEmptyStrings(values: string[], label: string) {
  expect(values.length, label).toBeGreaterThan(0);
  expect(values.every((value) => value.trim().length > 0), label).toBe(true);
}

describe("AI-native PBM agent catalog", () => {
  it("covers every declared domain exactly once", () => {
    expect(catalog.domainIds).toEqual(REQUIRED_DOMAINS);
    expect(catalog.domains.map((domain) => domain.id).sort()).toEqual(
      [...REQUIRED_DOMAINS].sort(),
    );
    expect(new Set(catalog.domains.map((domain) => domain.id)).size).toBe(13);

    for (const domain of catalog.domains) {
      expect(domain.name.trim(), `${domain.id} name`).not.toBe("");
      expect(domain.commercialPurpose.trim(), `${domain.id} purpose`).not.toBe("");
      expect(domain.processes.length, `${domain.id} process count`).toBeGreaterThanOrEqual(5);
      expect(domain.processes.length, `${domain.id} process count`).toBeLessThanOrEqual(8);
      expect(domain.processes.every((process) => process.domain === domain.id)).toBe(true);
    }
  });

  it("gives every process a stable unique identity and complete operating contract", () => {
    expect(processes.length).toBe(65);
    expect(new Set(processes.map((process) => process.id)).size).toBe(processes.length);

    for (const process of processes) {
      const label = process.id;
      expect(process.id.startsWith(`${process.domain}.`), label).toBe(true);
      expect(process.name.trim(), `${label} name`).not.toBe("");
      expect(process.description.length, `${label} description`).toBeGreaterThan(11);
      expect(process.trigger.event.trim(), `${label} trigger`).not.toBe("");
      expect(process.owner.trim(), `${label} owner`).not.toBe("");
      expect(process.accountableAuthority.trim(), `${label} authority`).not.toBe("");
      expectNonEmptyStrings(process.inputs, `${label} inputs`);
      expectNonEmptyStrings(process.outputs, `${label} outputs`);
      expectNonEmptyStrings(process.sourceOfTruth, `${label} sources`);
      expectNonEmptyStrings(process.evidence, `${label} evidence`);
      expectNonEmptyStrings(process.controls, `${label} controls`);
      expectNonEmptyStrings(process.downstreamEvents, `${label} downstream events`);
      expect(process.tools.length, `${label} tools`).toBeGreaterThan(0);
      expect(process.tools.every((tool) => tool.name && tool.access && tool.scope), label).toBe(
        true,
      );
      expect(process.metrics.length, `${label} metrics`).toBeGreaterThan(0);
      expect(process.metrics.every((metric) => metric.name && metric.target), label).toBe(true);
      expect(process.sla.target.trim(), `${label} SLA`).not.toBe("");
      expect(process.sla.escalation.trim(), `${label} SLA escalation`).not.toBe("");
      expect(process.failureHandling.fallback.trim(), `${label} fallback`).not.toBe("");
      expect(process.failureHandling.escalation.trim(), `${label} escalation`).not.toBe("");
      expect(process.failureHandling.recovery.trim(), `${label} recovery`).not.toBe("");
    }
  });

  it("uses only the governed execution, risk, autonomy, and consequence vocabularies", () => {
    for (const process of processes) {
      expect(EXECUTION_MODES.has(process.executionMode), process.id).toBe(true);
      expect(RISK_TIERS.has(process.riskTier), process.id).toBe(true);
      expect(AUTONOMY_LEVELS.has(process.autonomy), process.id).toBe(true);
      expect(
        process.consequenceClasses.every((item) => CONSEQUENCE_CLASSES.has(item)),
        process.id,
      ).toBe(true);
      expect(new Set(process.consequenceClasses).size, process.id).toBe(
        process.consequenceClasses.length,
      );
    }
  });

  it("keeps authoritative calculations deterministic", () => {
    const authoritative = processes.filter(
      (process) => process.authoritativeCalculation.required,
    );
    expect(authoritative.length).toBeGreaterThan(0);

    for (const process of authoritative) {
      expect(["deterministic", "hybrid"], process.id).toContain(process.executionMode);
      expect(process.authoritativeCalculation.authority, process.id).toBe(
        "deterministic-system",
      );
      expect(process.authoritativeCalculation.system?.trim(), process.id).toBeTruthy();
    }

    for (const process of processes.filter(
      (item) => !item.authoritativeCalculation.required,
    )) {
      expect(process.authoritativeCalculation.authority, process.id).toBe("not-applicable");
      expect(process.authoritativeCalculation.system, process.id).toBeNull();
    }
  });

  it("makes human authority and approvals explicit", () => {
    for (const process of processes) {
      if (process.executionMode === "human-authority") {
        expect(process.autonomy, process.id).toBe("human-only");
        expect(process.approval.required, process.id).toBe(true);
      }
      if (process.approval.required) {
        expect(process.approval.authority?.trim(), process.id).toBeTruthy();
        expect(process.approval.conditions.length, process.id).toBeGreaterThan(0);
      } else {
        expect(process.approval.authority, process.id).toBeNull();
        expect(process.approval.conditions, process.id).toEqual([]);
      }
      if (process.autonomy === "human-only") {
        expect(["hybrid", "human-authority"], process.id).toContain(
          process.executionMode,
        );
        expect(process.approval.required, process.id).toBe(true);
      }
    }
  });

  it("cross-references every current Glass agent and rejects unknown agent ids", () => {
    expect(catalog.currentGlassAgentIds).toEqual(CURRENT_AGENTS);
    const referenced = new Set(processes.flatMap((process) => process.currentGlassAgents));
    expect([...referenced].sort()).toEqual([...CURRENT_AGENTS].sort());
    expect(
      processes.every((process) =>
        process.currentGlassAgents.every((agent) =>
          (CURRENT_AGENTS as readonly string[]).includes(agent),
        ),
      ),
    ).toBe(true);
  });

  it("keeps the JSON Schema strict and aligned with runtime checks", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.properties.domains).toMatchObject({ minItems: 13, maxItems: 13 });
    expect(schema.$defs.process.additionalProperties).toBe(false);
    expect(schema.$defs.process.required).toEqual(
      expect.arrayContaining([
        "executionMode",
        "authoritativeCalculation",
        "consequenceClasses",
        "approval",
        "controls",
        "failureHandling",
      ]),
    );
    const processKeys = Object.keys(schema.$defs.process.properties).sort();
    expect(schema.$defs.process.required.slice().sort()).toEqual(processKeys);
    for (const process of processes) {
      expect(Object.keys(process).sort(), process.id).toEqual(processKeys);
    }
    expect(new Set(schema.$defs.process.properties.executionMode.enum)).toEqual(
      EXECUTION_MODES,
    );
    expect(
      new Set(schema.$defs.process.properties.consequenceClasses.items.enum),
    ).toEqual(CONSEQUENCE_CLASSES);
  });
});
