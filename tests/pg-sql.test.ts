import { describe, expect, it } from "vitest";
import { adaptSqliteDialect, sqlitePlaceholdersToPg } from "@/lib/pg-sql";

describe("adaptSqliteDialect date CAST AS REAL", () => {
  it("rewrites bare CAST(dateOfService AS REAL) to epoch millis", () => {
    const sql = adaptSqliteDialect(
      "SELECT CAST(dateOfService AS REAL) AS dateOfService FROM Claim",
    );
    expect(sql).toContain("EXTRACT(EPOCH FROM dateOfService)");
    expect(sql).not.toMatch(/CAST\(\s*dateOfService\s+AS\s+REAL\s*\)/i);
  });

  it("rewrites aliased bare CAST used by build-financials / build-mac", () => {
    const sql = adaptSqliteDialect(
      "SELECT CAST(c.dateOfService AS REAL) AS dos, CAST(a.dateOfService AS REAL) AS aDos FROM Claim c",
    );
    expect(sql).toContain("EXTRACT(EPOCH FROM c.dateOfService)");
    expect(sql).toContain("EXTRACT(EPOCH FROM a.dateOfService)");
    expect(sql).not.toMatch(/CAST\(\s*[a-z]\.dateOfService\s+AS\s+REAL\s*\)/i);
  });

  it("still rewrites CAST(MIN|MAX(date) AS REAL)", () => {
    const sql = adaptSqliteDialect(
      "SELECT CAST(MIN(c.dateOfService) AS REAL) AS firstClaim, CAST(MAX(c.dateOfService) AS REAL) AS lastClaim FROM Claim c",
    );
    expect(sql).toContain("EXTRACT(EPOCH FROM MIN(c.dateOfService))");
    expect(sql).toContain("EXTRACT(EPOCH FROM MAX(c.dateOfService))");
  });

  it("produces runnable Postgres SQL for the build-financials B1 select", () => {
    const modulus = Math.round(1 / 0.021);
    const adapted = sqlitePlaceholdersToPg(`
    SELECT id, claimNumber, sponsorId, memberId, eligibilitySpanId, benefitPlanId,
           pharmacyId, drugId, contractId, CAST(dateOfService AS REAL) AS dateOfService,
           rxNumber, fillNumber, quantityDispensed, daysSupply, prescriberNpi,
           totalBilledCents, planPaidCents, patientPayCents, totalAllowedCents,
           pharmacyPaidCents, allowedIngredientCostCents, allowedDispensingFeeCents,
           billedIngredientCostCents, billedDispensingFeeCents,
           appliedToDeductibleCents, copayCoinsuranceCents, brandSelectionPenaltyCents,
           estimatedRebateCents, channel, formularyLevel, brandGenericClass,
           isSpecialtyClaim, scenarioTag
    FROM Claim
    WHERE responseStatus = 'P' AND transactionCode = 'B1'
      AND CAST(SUBSTR(claimNumber, 4) AS INTEGER) % ${modulus} = 7
  `);
    expect(adapted).toContain('EXTRACT(EPOCH FROM "dateOfService")');
    expect(adapted).not.toMatch(/CAST\(\s*"dateOfService"\s+AS\s+REAL\s*\)/i);
    expect(adapted).toContain('FROM "Claim"');
  });
});
