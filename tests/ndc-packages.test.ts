/**
 * Reading package sizes out of the FDA NDC Directory.
 *
 * This is the data that turns "12 tubes per year" into a number the engine can
 * hold against a quantity billed in grams. It is worth testing carefully for a
 * blunt reason: a package size that is wrong by a factor of ten is a quantity
 * limit that is wrong by a factor of ten, and it will refuse fills with a
 * citation attached.
 */

import { describe, expect, it } from "vitest";
import {
  containerKey,
  normalizePackageNdc,
  parsePackageDescription,
} from "../scripts/ingest/ndc-packages";
import { resolvePackage } from "@/lib/engine/quantity-limit";

describe("reading one package description", () => {
  it("reads the simple two-level case", () => {
    // The Opzelura row, which is where this started.
    const p = parsePackageDescription(
      "1 TUBE in 1 CARTON (50881-007-05)  / 60 g in 1 TUBE",
    );
    expect(p).not.toBeNull();
    expect(p!.unit).toBe("GM");
    expect(p!.byContainer.get("TUBE")).toBe(60);
    expect(p!.byContainer.get("CARTON")).toBe(60);
    expect(p!.total).toBe(60);
  });

  it("multiplies through three levels", () => {
    const p = parsePackageDescription(
      "25 POUCH in 1 CARTON (0006-4047-20)  / 1 TUBE in 1 POUCH (0006-4047-02)  / 2 mL in 1 TUBE (0006-4047-01)",
    );
    expect(p).not.toBeNull();
    expect(p!.unit).toBe("ML");
    expect(p!.byContainer.get("TUBE")).toBe(2);
    expect(p!.byContainer.get("POUCH")).toBe(2);
    // Twenty-five pouches of one two-millilitre tube each.
    expect(p!.total).toBe(50);
  });

  it("sums the components of a kit", () => {
    const p = parsePackageDescription(
      "1 KIT in 1 CARTON (0009-7166-30)  / 1 KIT in 1 KIT *  1 mL in 1 VIAL, SINGLE-DOSE (0009-5175-02)  *  1 mL in 1 SYRINGE (0009-5936-01)",
    );
    expect(p).not.toBeNull();
    // A vial of one millilitre and a syringe of one millilitre is two.
    expect(p!.byContainer.get("KIT")).toBe(2);
  });

  it("normalizes milligrams and litres onto the billing unit", () => {
    const mg = parsePackageDescription("1 VIAL in 1 CARTON  / 500 mg in 1 VIAL");
    expect(mg!.unit).toBe("GM");
    expect(mg!.byContainer.get("VIAL")).toBe(0.5);

    const litre = parsePackageDescription("1 BAG in 1 CARTON  / 1 L in 1 BAG");
    expect(litre!.unit).toBe("ML");
    expect(litre!.byContainer.get("BAG")).toBe(1000);
  });

  it("has nothing to say about a bottle of tablets", () => {
    // Tablets are already the billing unit, so there is no conversion here and
    // pretending otherwise would invent one.
    expect(parsePackageDescription("30 TABLET in 1 BOTTLE (0093-1234-01)")).toBeNull();
    expect(parsePackageDescription("")).toBeNull();
    expect(parsePackageDescription("something FDA did not write")).toBeNull();
  });

  it("drops the package codes rather than counting them", () => {
    const p = parsePackageDescription(
      "1 TUBE, WITH APPLICATOR in 1 CARTON (0009-3448-01)  / 40 g in 1 TUBE, WITH APPLICATOR",
    );
    expect(p!.byContainer.get("TUBE")).toBe(40);
  });
});

describe("container nouns", () => {
  it("reduces the qualifiers a formulary never writes", () => {
    expect(containerKey("VIAL, SINGLE-DOSE")).toBe("VIAL");
    expect(containerKey("TUBE, WITH APPLICATOR")).toBe("TUBE");
    expect(containerKey("tubes")).toBe("TUBE");
    expect(containerKey("BOTTLE, PLASTIC")).toBe("BOTTLE");
  });
});

describe("NDC package codes", () => {
  it("pads every segment configuration onto eleven digits", () => {
    expect(normalizePackageNdc("0023-0312-04")).toBe("00023031204");
    expect(normalizePackageNdc("50458-580-01")).toBe("50458058001");
    expect(normalizePackageNdc("50881-007-05")).toBe("50881000705");
  });

  it("refuses a code that is not a package code", () => {
    expect(normalizePackageNdc("0023-0312")).toBeNull();
    expect(normalizePackageNdc("")).toBeNull();
  });
});

describe("matching the formulary's noun to the FDA's", () => {
  const opzelura = {
    containers: { TUBE: 60, CARTON: 60 },
    packageSize: 60,
    unitOfMeasure: "GM",
  };

  it("uses the named container when both documents agree", () => {
    const r = resolvePackage("tubes", opzelura);
    expect(r?.unitsPerPackage).toBe(60);
    expect(r?.basis).toContain("FDA NDC Directory");
  });

  it("reads a generic package noun as the thing that leaves the shelf", () => {
    // "1 pack/28 days" against a carton holding one 3 mL pen means the carton.
    const r = resolvePackage("pack", {
      containers: { SYRINGE: 3, CARTON: 3 },
      packageSize: 3,
      unitOfMeasure: "ML",
    });
    expect(r?.unitsPerPackage).toBe(3);
  });

  it("accepts that a pen and a syringe are one container", () => {
    const r = resolvePackage("pens", {
      containers: { SYRINGE: 0.5, CARTON: 2 },
      packageSize: 2,
      unitOfMeasure: "ML",
    });
    expect(r?.unitsPerPackage).toBe(0.5);
    expect(r?.basis).toContain("which the formulary calls a pen");
  });

  it("treats the each as the container when the drug is priced per each", () => {
    // NADAC prices cyclosporine ophthalmic emulsion per each, and the each is
    // one vial, so a limit of sixty vials is already in billable units.
    const r = resolvePackage("vials", {
      containers: { VIAL: 0.9, CARTON: 54 },
      packageSize: null,
      unitOfMeasure: "EA",
    });
    expect(r?.unitsPerPackage).toBe(1);
  });

  it("declines when nothing on file describes the container", () => {
    const r = resolvePackage("inhalers", {
      containers: null,
      packageSize: 1,
      unitOfMeasure: "GM",
    });
    expect(r).toBeNull();
  });

  it("does not read an unpopulated size as a package of one", () => {
    // The default from the schema, on a drug billed by the gram. Nobody
    // dispenses a one-gram tube, so this is an empty column and not a fact.
    const r = resolvePackage("pack", {
      containers: null,
      packageSize: 1,
      unitOfMeasure: "GM",
    });
    expect(r).toBeNull();
  });

  it("does accept a sourced package of one", () => {
    // A one-millilitre prefilled syringe is a real package. The container map
    // is what distinguishes it from an empty column.
    const r = resolvePackage("pack", {
      containers: { SYRINGE: 1, CARTON: 1 },
      packageSize: 1,
      unitOfMeasure: "ML",
    });
    expect(r?.unitsPerPackage).toBe(1);
  });
});
