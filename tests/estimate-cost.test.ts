/**
 * Member cost quotes must honour the member's accumulated out-of-pocket.
 *
 * Quoting through the adjudication engine with a fresh zero balance invents a
 * copay that the pharmacy counter — which rebuilds history first — will not
 * charge. These cases pin the engine contract the quote path has to honour;
 * the agent suite checks the wiring against Margaret's seeded year.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adjudicate } from "@/lib/engine/adjudicate";
import { drug, entry, makeContext } from "./fixtures";

describe("a Level 1 fill after the $600 Rx OOP limit is met", () => {
  it("costs the member nothing", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 0.42, isBrandLabel: false }),
        formularyEntry: entry({ level: "1" }),
        quantityDispensed: 30,
        daysSupply: 30,
        accumulators: {
          rxOopAccumulatedCents: 60_000,
          federalOopAccumulatedCents: 60_000,
          deductibleAccumulatedCents: 0,
        },
      }),
    );

    expect(out.responseStatus).toBe("P");
    expect(out.patientPayCents).toBe(0);
  });

  it("still charges the copay when the member has not met the limit", () => {
    const out = adjudicate(
      makeContext({
        drug: drug({ nadacPerUnit: 0.42, isBrandLabel: false }),
        formularyEntry: entry({ level: "1" }),
        quantityDispensed: 30,
        daysSupply: 30,
        accumulators: {
          rxOopAccumulatedCents: 0,
          federalOopAccumulatedCents: 0,
          deductibleAccumulatedCents: 0,
        },
      }),
    );

    expect(out.responseStatus).toBe("P");
    expect(out.patientPayCents).toBe(500);
  });
});

describe("estimateCost wiring", () => {
  it("prices through POS simulateFill rather than empty history", () => {
    const source = readFileSync("src/lib/agent/tools.ts", "utf8");
    const fn = source.slice(
      source.indexOf("export async function estimateCost"),
      source.indexOf("export async function getPriorAuthStatus"),
    );
    expect(fn).toContain("simulateFill");
    expect(fn).not.toMatch(/accumulators:\s*\{\s*rxOopAccumulatedCents:\s*0/);
    expect(fn).not.toContain("priorFills: []");
  });
});
