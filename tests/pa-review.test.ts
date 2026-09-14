/**
 * Who may record what, and on which clock.
 *
 * The rule under test is the one the whole prior authorization design rests on:
 * automation may approve and only a person may refuse. It is worth testing as a
 * function rather than as a paragraph, because a paragraph on a page cannot stop
 * a write, and the difference between the two is the entire claim.
 *
 * The deadline tests sit here too, since the reviewer's queue is ordered by
 * them. The case that matters is the exception clock: a request the plan is not
 * yet permitted to decide cannot be late, and getting that wrong in either
 * direction produces a false report — late on requests it could not answer, or
 * no deadline at all on requests that have one.
 */

import { describe, expect, it } from "vitest";
import {
  contractualSla,
  computeSla,
  isExceptionRequest,
  paDeadlines,
} from "@/lib/pa/engine";
import {
  dispositionFor,
  EXCEPTION_KINDS,
  exceptionKind,
  grantsPriorAuthCoverage,
  mayAppeal,
  mayRecord,
  reviewerLabel,
  type Reviewer,
} from "@/lib/pa/review";

const AUTOMATION: Reviewer = { kind: "automation", label: "Glass criteria engine" };
const PHARMACIST: Reviewer = {
  kind: "pharmacist",
  label: "Rachel Imhoff, PharmD",
  licence: "WI-RPH-041882",
};

describe("who may refuse", () => {
  it("refuses to let automation record a denial", () => {
    const verdict = mayRecord(AUTOMATION, {
      record: "Denied",
      reason: "Criteria not met at step 8.",
      decidingStep: 8,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.requiresSignature).toBe(true);
    expect(verdict.decidedBy).toBeUndefined();
    // The refusal has to explain itself, because a caller that gets a bare 403
    // will assume a bug and retry.
    expect(verdict.refusal).toMatch(/pharmacist/i);
  });

  it("lets a pharmacist record a denial, with the licence attached", () => {
    const verdict = mayRecord(PHARMACIST, {
      record: "Denied",
      reason: "Criteria not met.",
      decidingStep: 8,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.decidedBy).toBe("Rachel Imhoff, PharmD (WI-RPH-041882)");
    expect(reviewerLabel(PHARMACIST)).toContain("WI-RPH-041882");
  });

  it("lets automation record an approval that names its deciding step", () => {
    const verdict = mayRecord(AUTOMATION, {
      record: "Approved",
      approvedDays: 365,
      decidingStep: 7,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.decidedBy).toBe("Glass criteria engine");
  });

  it("refuses an automated approval that cannot name a step", () => {
    /*
     * An approval nobody can locate in the criteria is indistinguishable from
     * an approval nobody applied criteria to, so the citation is a condition of
     * the write rather than a nicety on the page.
     */
    const verdict = mayRecord(AUTOMATION, {
      record: "Approved",
      approvedDays: 365,
      decidingStep: null,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.refusal).toMatch(/deciding step/i);
  });

  it("lets a pharmacist approve without a step, because they are not walking a tree", () => {
    const verdict = mayRecord(PHARMACIST, {
      record: "Approved",
      approvedDays: 90,
      decidingStep: null,
    });
    expect(verdict.allowed).toBe(true);
  });

  it("always allows escalation, from either side", () => {
    for (const reviewer of [AUTOMATION, PHARMACIST]) {
      const verdict = mayRecord(reviewer, {
        record: "Escalated",
        reason: "Criteria do not resolve on the facts submitted.",
      });
      expect(verdict.allowed).toBe(true);
      expect(verdict.requiresSignature).toBe(false);
    }
  });
});

describe("what automation does with a traversal", () => {
  it("records an approval, proposes a refusal, and escalates everything else", () => {
    expect(dispositionFor("Approved").action).toBe("record");
    expect(dispositionFor("Denied").action).toBe("propose");
    expect(dispositionFor("Escalated").action).toBe("escalate");
  });

  it("never proposes and records the same outcome", () => {
    // The two functions answer different questions, and the pairing is the
    // invariant: anything automation only proposes must be something it cannot
    // record.
    const proposed = dispositionFor("Denied");
    expect(proposed.action).toBe("propose");
    expect(
      mayRecord(AUTOMATION, { record: "Denied", reason: "x", decidingStep: 1 })
        .allowed,
    ).toBe(false);
  });
});

describe("appeals", () => {
  it("has nothing to appeal when the request was approved", () => {
    const verdict = mayAppeal({ determination: "Approved", decidedBy: "AI" });
    expect(verdict.allowed).toBe(false);
  });

  it("names the reviewer the appeal may not be decided by", () => {
    const verdict = mayAppeal({
      determination: "Denied",
      decidedBy: "Rachel Imhoff, PharmD (WI-RPH-041882)",
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.mustDifferFrom).toBe(
      "Rachel Imhoff, PharmD (WI-RPH-041882)",
    );
  });
});

describe("which Approved rows satisfy requiresPA at the counter", () => {
  it("counts prior authorizations, reauthorizations, appeals, and formulary exceptions", () => {
    for (const kind of ["PA", "Reauthorization", "Appeal", "FormularyException"]) {
      expect(grantsPriorAuthCoverage(kind)).toBe(true);
    }
  });

  it("does not let a step, quantity, or tiering exception stand in for a PA", () => {
    // Approving EX2026000202-style StepException for a specialty PA drug used
    // to enter loadWorld's approvedPAs map and pay the fill. Those request
    // types ask for a different edit.
    for (const kind of [
      "StepException",
      "QuantityException",
      "TieringException",
      "Grievance",
    ]) {
      expect(grantsPriorAuthCoverage(kind)).toBe(false);
    }
  });
});

describe("the kinds a member can file", () => {
  it("requires a supporting statement on everything that departs from the formulary", () => {
    for (const kind of [
      "FormularyException",
      "StepException",
      "QuantityException",
      "TieringException",
    ] as const) {
      expect(exceptionKind(kind)?.needsSupportingStatement).toBe(true);
      expect(isExceptionRequest(kind)).toBe(true);
    }
  });

  it("requires none on an appeal or a grievance", () => {
    expect(exceptionKind("Appeal")?.needsSupportingStatement).toBe(false);
    expect(exceptionKind("Grievance")?.needsSupportingStatement).toBe(false);
    expect(isExceptionRequest("Appeal")).toBe(false);
    expect(isExceptionRequest("PA")).toBe(false);
  });

  it("cites an authority for every one of them", () => {
    for (const k of EXCEPTION_KINDS) {
      expect(k.citation.length).toBeGreaterThan(40);
      expect(k.asks.length).toBeGreaterThan(40);
    }
  });
});

describe("the two deadlines", () => {
  const received = new Date("2026-03-02T09:00:00Z");

  it("holds a standard commercial request to the contract, twelve days before the law does", () => {
    const d = paDeadlines(received, "Standard", "Commercial");
    expect(d.contractual.hours).toBe(72);
    expect(d.regulatory.hours).toBe(15 * 24);
    expect(d.bindingSource).toBe("contractual");
    expect(d.binding.dueAt).toEqual(d.contractual.dueAt);
  });

  it("holds an expedited commercial request to 24 hours rather than 72", () => {
    const d = paDeadlines(received, "Expedited", "Commercial");
    expect(d.contractual.hours).toBe(24);
    expect(d.regulatory.hours).toBe(72);
    expect(d.bindingSource).toBe("contractual");
  });

  it("still reports the regulatory clock, because the two fail differently", () => {
    const d = paDeadlines(received, "Standard", "Commercial");
    // Missing the contract draws on the amount at risk; missing the regulation
    // vests the member's right to external review. A queue that tracks only one
    // of them is blind to the other.
    expect(d.regulatory.citation).toMatch(/2560\.503-1/);
    expect(d.regulatory.onExpiry).toMatch(/external review/i);
    expect(d.contractual.onExpiry).toMatch(/at risk/i);
  });

  it("matches Part D on an EGWP request, where the regulation is the tighter one", () => {
    const d = paDeadlines(received, "Standard", "EGWP");
    expect(d.regulatory.hours).toBe(72);
    expect(d.contractual.hours).toBe(72);
    // A tie goes to the contract, which is the same instant either way.
    expect(d.binding.dueAt).toEqual(d.regulatory.dueAt);
  });
});

describe("the exception clock", () => {
  const received = new Date("2026-03-02T09:00:00Z");
  const statement = new Date("2026-03-11T14:00:00Z");

  it("starts on the supporting statement, not on the filing", () => {
    const d = paDeadlines(received, "Standard", "Commercial", {
      requestType: "FormularyException",
      supportingStatementAt: statement,
    });
    expect(d.binding.startedAt).toEqual(statement);
    expect(d.binding.dueAt).toEqual(
      new Date(statement.getTime() + 72 * 3_600_000),
    );
  });

  it("reports that it has not started when no statement has arrived", () => {
    const d = paDeadlines(received, "Standard", "Commercial", {
      requestType: "StepException",
      supportingStatementAt: null,
    });
    expect(d.binding.awaitingSupportingStatement).toBe(true);
    expect(d.regulatory.awaitingSupportingStatement).toBe(true);
  });

  it("does not move the clock on an ordinary authorization", () => {
    const d = paDeadlines(received, "Standard", "Commercial", {
      requestType: "PA",
      // Even with a statement on file, a plain PA runs from receipt: measuring
      // from the statement on a request that needs none would make every
      // deadline quietly disappear.
      supportingStatementAt: statement,
    });
    expect(d.binding.startedAt).toEqual(received);
  });

  it("agrees between the two authorities about when the clock started", () => {
    const opts = {
      requestType: "QuantityException",
      supportingStatementAt: statement,
    };
    expect(computeSla(received, "Standard", "Commercial", opts).startedAt).toEqual(
      contractualSla(received, "Standard", opts).startedAt,
    );
  });
});
