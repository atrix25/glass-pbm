/**
 * The formulary parse, and the edits that depend on it.
 *
 * A parser over a 259-page fixed-width PDF is the least glamorous part of this
 * system and one of the easiest places for a silent failure to hide, because a
 * flag can be set with nothing behind it. The formulary marks OZEMPIC as
 * restricted to a diagnosis; if the ICD-10 code the restriction names is not
 * extracted, the entry still reads as configured, the engine still runs the
 * check, and it can never once refuse a claim. That defect was real in this
 * repository — `\([^)]*\)` does not match the nested bracket in
 * "Diagnosis Restricted – Type 2 Diabetes (E11)" — and it survived because
 * nothing asserted that a coded restriction had anything underneath it.
 *
 * So these tests check the arithmetic of the parse rather than a sample of its
 * output: that every rule the legend codes is either enforceable or explicitly
 * counted as a hole, and that the restrictions the document does carry actually
 * reject a claim in the engine.
 */

import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { adjudicate } from "@/lib/engine/adjudicate";
import {
  CODE_LEGEND,
  cleanDrugName,
  decodeFormularyRow,
  parseDiagnosisRestriction,
} from "../scripts/ingest/formulary";
import { drug, entry, makeContext } from "./fixtures";

const FORMULARY_ID = "navitus-etf-2026";

function row(drugName: string, specialCode = "-", level = "2") {
  return decodeFormularyRow({
    drugName,
    specialCode,
    level,
    category: "TEST",
    page: 1,
  });
}

describe("the special code legend is decoded, not guessed", () => {
  it("carries every token the document's footer prints", () => {
    // Transcribed from the legend on every page of the index. RxCENTS is the
    // cent sign; the words are its expansion, not a code that appears in the
    // column.
    for (const token of [
      "EXC", "INF", "LD", "LMSP", "MSP", "OTC", "PA", "QL",
      "RDX", "RS", "SF", "SMKG", "ST", "VAC", "NC", "3P", "¢",
    ]) {
      expect(CODE_LEGEND[token], `legend is missing ${token}`).toBeTruthy();
    }
    expect(CODE_LEGEND["¢"]).toBe("RxCENTS");
    expect(CODE_LEGEND.RDX).toBe("Restricted to Diagnosis");
  });

  it("decodes a compound code into every edit it implies", () => {
    const r = row("SOME DRUG INJ", "MSP-PA-QL", "4");
    expect(r.requiresPA).toBe(true);
    expect(r.hasQuantityLimit).toBe(true);
    expect(r.mandatorySpecialty).toBe(true);
    expect(r.requiresStep).toBe(false);
  });

  it("reads brand and generic off capitalisation, as the legend says to", () => {
    // "generic = small letters, BRANDS = CAPITAL LETTERS", measured before any
    // bracket so "(LIPITOR equiv)" does not make a generic look like a brand.
    expect(row("OZEMPIC INJ").isBrandName).toBe(true);
    expect(row("atorvastatin tab (LIPITOR equiv)").isBrandName).toBe(false);
  });
});

describe("nested brackets do not corrupt the product name", () => {
  it("keeps a packaging designator and drops a rule clause", () => {
    // Both arrive in brackets and only one belongs in the name: strip too much
    // and this becomes a different insulin.
    expect(cleanDrugName("HUMULIN R U-500 (CONCENTRATE)")).toBe(
      "HUMULIN R U-500 (CONCENTRATE)",
    );
    expect(cleanDrugName("VENTOLIN HFA INHALER (QL= 2 inhalers/30 days)")).toBe(
      "VENTOLIN HFA INHALER",
    );
  });

  it("survives a rule clause that contains its own brackets", () => {
    // The case that was broken. A non-greedy bracket match stops at "(E11" and
    // leaves the closing bracket stranded on the end of the name.
    expect(
      cleanDrugName(
        "OZEMPIC INJ (QL= 1 pack/28 days; Diagnosis Restricted – Type 2 Diabetes (E11))",
      ),
    ).toBe("OZEMPIC INJ");
    expect(
      cleanDrugName(
        "morphine sulfate ER tab (MS CONTIN equiv) (Step Therapy requires step through IR opioid if opioid naïve (Opioid ER Dependency))",
      ),
    ).toBe("morphine sulfate ER tab");
  });

  it("never leaves rule language inside a product name", () => {
    // The worst version of the old defect: the tail of a utilisation rule was
    // stored as part of the drug's name and shown on member claim history.
    const cleaned = cleanDrugName(
      "DEXCOM G6 RECEIVER (QL= 1 receiver/year; Prior authorization (exception) required if member is not currently utilizing insulin)",
    );
    expect(cleaned).toBe("DEXCOM G6 RECEIVER");
    expect(cleaned).not.toMatch(/insulin|authorization|QL=/i);
  });

  it("leaves no unbalanced bracket behind", () => {
    for (const name of [
      "ketorolac ophth soln (ACULAR (LS) equiv)",
      "efavirenz/lamivudine/tenofovir df (lo) tab (SYMFI (LO) equiv)",
      "ezetimibe/simvastatin tab (VYTORIN equiv) (QL= 1 tab/day (10-80mg is Not Covered))",
    ]) {
      const cleaned = cleanDrugName(name);
      const opens = (cleaned.match(/\(/g) ?? []).length;
      const closes = (cleaned.match(/\)/g) ?? []).length;
      expect(opens, `unbalanced: ${cleaned}`).toBe(closes);
    }
  });
});

describe("a coded restriction has something underneath it", () => {
  it("extracts the ICD-10 code the restriction names", () => {
    const parsed = parseDiagnosisRestriction(
      "OZEMPIC INJ (QL= 1 pack/28 days; Diagnosis Restricted – Type 2 Diabetes (E11))",
    );
    expect(parsed.codes).toEqual(["E11"]);
    expect(parsed.rawText).toContain("Type 2 Diabetes");
  });

  it("parses quantity limits across every period the document uses", () => {
    /*
     * A unit missing from the alternation does not fail loudly: the flag stays
     * set and the numbers come back undefined. The unit matters as much as the
     * numbers — "1 ring" and "180 days" are not quantities of drug, and reading
     * them as quantities refuses fills — so the basis is asserted alongside.
     */
    const cases: [name: string, quantity: number, days: number | undefined, basis: string][] = [
      ["A INJ (QL= 4 inj/28 days)", 4, 28, "dispensing-unit"],
      ["B TAB (QL= 2 tabs/day)", 2, 1, "dispensing-unit"],
      ["C INJ (QL= 2 vials/26 weeks)", 2, 182, "package"],
      ["D RING (QL= 1 ring/year)", 1, 365, "package"],
      // A per-fill limit has no period. Calling it thirty days would turn a
      // ceiling on one fill into a rate over time.
      ["E CAP (QL= 1 cap/fill)", 1, undefined, "dispensing-unit"],
      ["F gum (Limited to 180 days/plan year)", 180, 365, "days-supply"],
      ["G PAK (Limited to 2 fills/plan year)", 2, 365, "fill-count"],
    ];
    for (const [name, quantity, days, basis] of cases) {
      const r = row(name, "QL");
      expect(r.qlQuantity, name).toBe(quantity);
      expect(r.qlDays, name).toBe(days);
      expect(r.qlBasis, name).toBe(basis);
    }
  });

  it("has no parsed limit in the book whose unit it cannot classify", async () => {
    /*
     * A quantity with no classified unit is a number, not a limit. Left in the
     * database it looks configured and either does nothing or fires on a
     * comparison between two different measurements. Either way the operator
     * cannot tell from the record, so the ingest records the basis or nothing.
     */
    const parsed = await prisma.formularyEntry.count({
      where: { formularyId: FORMULARY_ID, qlQuantity: { not: null } },
    });
    const classified = await prisma.formularyEntry.count({
      where: {
        formularyId: FORMULARY_ID,
        qlQuantity: { not: null },
        qlBasis: { not: null },
      },
    });
    expect(parsed).toBeGreaterThan(100);
    expect(classified).toBe(parsed);
  });

  it("has no diagnosis restriction in the book without an ICD-10 code", async () => {
    // The invariant that would have caught the original defect.
    const coded = await prisma.formularyEntry.count({
      where: { formularyId: FORMULARY_ID, diagnosisRestricted: true },
    });
    const empty = await prisma.formularyEntry.count({
      where: {
        formularyId: FORMULARY_ID,
        diagnosisRestricted: true,
        requiredDiagnosisCodes: "[]",
      },
    });
    expect(coded).toBeGreaterThan(0);
    expect(empty).toBe(0);
  });

  it("keeps the specialist restriction out of the diagnosis column", async () => {
    // The two edits shared one field once, and the diagnosis text lost.
    const confused = await prisma.formularyEntry.count({
      where: {
        formularyId: FORMULARY_ID,
        diagnosisRawText: { contains: "Restricted to" },
      },
    });
    expect(confused).toBe(0);

    const specialist = await prisma.formularyEntry.count({
      where: { formularyId: FORMULARY_ID, specialistRawText: { not: null } },
    });
    expect(specialist).toBeGreaterThan(0);
  });

  it("stores no drug name carrying a rule clause", async () => {
    const suspects = await prisma.drug.findMany({
      where: {
        OR: [
          { name: { contains: "QL=" } },
          { name: { contains: "Diagnosis Restricted" } },
          { name: { contains: "utilizing insulin" } },
          { name: { contains: "equiv)" } },
        ],
      },
      select: { name: true },
      take: 5,
    });
    expect(suspects.map((d) => d.name)).toEqual([]);
  });
});

describe("the diagnosis restriction fires at the point of sale", () => {
  /*
   * The plan's own argument for why this is the better demo than a prior
   * authorisation: weight-loss GLP-1s are excluded outright, and the diabetes
   * ones are managed by a quantity limit plus an ICD-10 restriction inside the
   * transaction rather than in a side workflow. That only holds if the edit
   * actually refuses a claim, which needs the code parsed out of the document.
   */
  const ozempic = drug({ name: "OZEMPIC INJ", isBrandLabel: true, nadacPerUnit: 90 });
  const restricted = entry({
    level: "2",
    specialCode: "QL-RDX",
    diagnosisRestricted: true,
    requiredDiagnosisCodes: ["E11"],
    diagnosisRawText: "Diagnosis Restricted – Type 2 Diabetes (E11)",
  });

  it("rejects with NCPDP 80 when no qualifying diagnosis is on file", () => {
    const result = adjudicate(
      makeContext({
        drug: ozempic,
        formularyEntry: restricted,
        diagnosisCodes: ["I10", "E78"],
      }),
    );
    expect(result.responseStatus).toBe("R");
    expect(result.rejectCodes).toContain("80");
  });

  it("pays the same claim for a member who has the diagnosis", () => {
    const result = adjudicate(
      makeContext({
        drug: ozempic,
        formularyEntry: restricted,
        diagnosisCodes: ["E11.9"],
      }),
    );
    expect(result.responseStatus).toBe("P");
  });

  it("cites the formulary clause in the trace either way", () => {
    const refused = adjudicate(
      makeContext({
        drug: ozempic,
        formularyEntry: restricted,
        diagnosisCodes: ["I10"],
      }),
    );
    const step = refused.trace.find((s) => s.ruleId === "um.diagnosis-restriction");
    expect(step).toBeDefined();
    expect(step!.fired).toBe(true);
    expect(step!.sourceDocumentId).toBeTruthy();
    expect(step!.citation).toContain("Type 2 Diabetes");
  });

  it("does not refuse a drug the document leaves unrestricted", () => {
    const result = adjudicate(
      makeContext({
        drug: drug({ name: "atorvastatin tab", nadacPerUnit: 0.2 }),
        formularyEntry: entry({ level: "1" }),
        diagnosisCodes: [],
      }),
    );
    expect(result.responseStatus).toBe("P");
  });

  it("has members in the book on both sides of the restriction", async () => {
    // A restriction nobody can satisfy and a restriction nobody trips are both
    // useless as a demonstration.
    const withDx = await prisma.member.count({
      where: { diagnosisCodes: { contains: "E11" } },
    });
    const total = await prisma.member.count();
    expect(withDx).toBeGreaterThan(100);
    expect(withDx).toBeLessThan(total);
  });
});
