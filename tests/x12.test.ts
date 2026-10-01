import { describe, expect, it } from "vitest";
import { renderX12, type X12Source } from "@/lib/eligibility/x12";

const source = (over: Partial<X12Source["transaction"]> = {}): X12Source => ({
  controlNumber: "123456789",
  senderId: "GLASS",
  receiverId: "NAVITUS",
  fileType: "Change",
  createdAt: new Date("2026-01-02T15:04:05Z"),
  sponsorName: "Wisconsin ETF",
  dateOfBirth: new Date("1980-06-07T00:00:00Z"),
  gender: undefined,
  transaction: {
    maintenanceType: "001",
    maintenanceReason: "25",
    cardholderId: "CARD123",
    personCode: "01",
    relationshipCode: "18",
    memberName: "Doe, Jane",
    benefitPlanId: "plan-1",
    coverageTier: "Family",
    effectiveDate: new Date("2026-01-01T00:00:00Z"),
    terminationDate: new Date("2026-12-31T00:00:00Z"),
    ...over,
  },
});

describe("renderX12", () => {
  it("renders the envelope, member detail, and trailers with the actual count", () => {
    const segments = renderX12(source());
    const text = segments.map((s) => s.text);

    expect(text[0]).toContain("ISA*00*");
    expect(text[0]).toContain("*00501*123456789*0*P*:~");
    expect(text[1]).toBe(
      "GS*BE*GLASS*NAVITUS*20260102*1504*456789*X*005010X220A1~",
    );
    expect(text[2]).toBe("ST*834*0001*005010X220A1~");
    expect(text[3]).toBe("BGN*00*123456789*20260102*1504*ET***2~");
    expect(text).toContain("REF*0F*CARD123~");
    expect(text).toContain("REF*17*01~");
    expect(text).toContain("REF*1L*PLAN-1~");
    expect(text).toContain("NM1*IL*1*DOE*JANE****34*CARD123~");
    expect(text).toContain("DMG*D8*19800607*U~");
    expect(text).toContain("DTP*356*D8*20260101~");
    expect(text).toContain("DTP*357*D8*20261231~");
    expect(text).toContain("HD*001**PDG*PLAN-1*FAM~");
    expect(text).toContain("DTP*348*D8*20260101~");
    expect(text).toContain("DTP*349*D8*20261231~");
    expect(text.at(-3)).toBe("SE*21*0001~");
    expect(text.at(-2)).toBe("GE*1*456789~");
    expect(text.at(-1)).toBe("IEA*1*123456789~");
  });

  it("uses action 4 for a verify file and omits a null benefit plan", () => {
    const segments = renderX12({
      ...source({
        memberName: "Madonna",
        benefitPlanId: null,
        coverageTier: "Employee",
        effectiveDate: null,
        terminationDate: null,
      }),
      fileType: "Verify",
      dateOfBirth: null,
    });
    const text = segments.map((s) => s.text);

    expect(text[3]).toBe("BGN*00*123456789*20260102*1504*ET***4~");
    expect(text).toContain("REF*0F*CARD123~");
    expect(text).toContain("REF*17*01~");
    expect(text.some((segment) => segment.startsWith("REF*1L"))).toBe(false);
    expect(text).toContain("NM1*IL*1*MADONNA*****34*CARD123~");
    expect(text.some((segment) => segment.startsWith("DMG"))).toBe(false);
    expect(text).toContain("HD*001**PDG*UNKNOWN*EMP~");
    expect(text.some((segment) => segment.startsWith("DTP*356"))).toBe(false);
    expect(text.some((segment) => segment.startsWith("DTP*357"))).toBe(false);
    expect(text.some((segment) => segment.startsWith("DTP*348"))).toBe(false);
    expect(text.some((segment) => segment.startsWith("DTP*349"))).toBe(false);
  });
});
