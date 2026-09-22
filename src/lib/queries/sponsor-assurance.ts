import { prisma } from "@/lib/db";
import { tenantSponsorId } from "@/lib/config";
import { PLAN_YEAR_START, type SimulationClock } from "@/lib/clock";
import { invoiceDifference, measuredCheck, type AssuranceCheck } from "@/lib/assurance";

export async function getSponsorAssurance(clock: SimulationClock) {
  const sponsorId = tenantSponsorId();
  const sponsor = await prisma.planSponsor.findUniqueOrThrow({ where: { id: sponsorId } });
  const contract = await prisma.contract.findUniqueOrThrow({ where: { id: sponsor.contractId } });
  const [raw] = await prisma.$queryRaw<Array<Record<string, bigint | Date | null>>>`
    SELECT COUNT(*) FILTER (WHERE c."responseStatus" = 'P') AS paid,
      COUNT(*) FILTER (WHERE c."responseStatus" = 'R') AS rejected,
      MAX(c."adjudicatedAt") AS latest,
      COUNT(*) FILTER (WHERE c."responseStatus" = 'P' AND c."totalBilledCents" <> c."totalAllowedCents") AS spread,
      COALESCE(SUM(ABS(c."totalBilledCents" - c."totalAllowedCents")) FILTER (WHERE c."responseStatus" = 'P'),0) AS "spreadAmount",
      COUNT(*) FILTER (WHERE c."responseStatus" = 'P' AND c."billedIngredientCostCents" <> c."allowedIngredientCostCents") AS ingredient,
      COALESCE(SUM(ABS(c."billedIngredientCostCents" - c."allowedIngredientCostCents")) FILTER (WHERE c."responseStatus" = 'P'),0) AS "ingredientAmount",
      COUNT(*) FILTER (WHERE c."responseStatus" = 'P' AND c."billedDispensingFeeCents" <> c."allowedDispensingFeeCents") AS fee,
      COALESCE(SUM(ABS(c."billedDispensingFeeCents" - c."allowedDispensingFeeCents")) FILTER (WHERE c."responseStatus" = 'P'),0) AS "feeAmount",
      COUNT(*) FILTER (WHERE c."responseStatus" = 'P' AND c."planPaidCents" + c."patientPayCents" <> c."totalBilledCents") AS split,
      COALESCE(SUM(ABS(c."planPaidCents" + c."patientPayCents" - c."totalBilledCents")) FILTER (WHERE c."responseStatus" = 'P'),0) AS "splitAmount",
      COUNT(*) FILTER (WHERE c."responseStatus" = 'R' AND (c."planPaidCents" <> 0 OR c."patientPayCents" <> 0 OR c."pharmacyPaidCents" <> 0)) AS "rejectMoney",
      COUNT(*) FILTER (WHERE c."responseStatus" = 'P' AND c."excludedFromDiscountGuarantee") AS excluded,
      COUNT(*) FILTER (WHERE c."responseStatus" = 'P' AND c."excludedFromDiscountGuarantee" AND (c."discountExclusionReason" IS NULL OR TRIM(c."discountExclusionReason") = '')) AS "missingReason",
      COUNT(*) FILTER (WHERE c."responseStatus" = 'P' AND c."basisOfReimbursement" = '3') AS "awpClaims",
      COUNT(*) FILTER (WHERE c."responseStatus" = 'P' AND c."basisOfReimbursement" = '3' AND (c."awpTotalCents" IS NULL OR c."awpTotalCents" <= 0)) AS "missingAwp",
      COUNT(*) FILTER (WHERE c."responseStatus" = 'P' AND c."awpIsSimulated") AS simulated
    FROM "Claim" c
    WHERE c."sponsorId" = ${sponsorId} AND c."contractId" = ${contract.id}
      AND c."dateOfService" >= ${PLAN_YEAR_START} AND c."dateOfService" <= ${clock.now}
      AND c."adjudicatedAt" <= ${clock.now} AND c."transactionCode" IN ('B1','B3')
      AND c."responseStatus" IN ('P','R')
      AND NOT EXISTS (SELECT 1 FROM "Claim" r WHERE r."reversalOfClaimId" = c.id
        AND r."sponsorId" = ${sponsorId} AND r."responseStatus" = 'A' AND r."transactionCode" = 'B2'
        AND r."adjudicatedAt" <= ${clock.now})
  `;
  const n = (key: string) => Number(raw?.[key] ?? 0);
  const paid = n("paid");
  const invoices = await prisma.sponsorInvoice.findMany({ where: { sponsorId, periodStart: { gte: PLAN_YEAR_START }, periodEnd: { lte: clock.now }, issuedAt: { lte: clock.now } } });
  const differences = invoices.map(invoiceDifference);
  const activeRates = await prisma.contractRate.findMany({ where: { contractId: contract.id, rateSide: "Client", effectiveDate: { lte: clock.now }, OR: [{ terminationDate: null }, { terminationDate: { gte: clock.now } }] }, select: { sourceDocumentId: true, citation: true } });
  const checks: AssuranceCheck[] = [];
  function claimCheck(id: string, title: string, key: string, method: string) {
    const exceptions = n(key);
    checks.push(measuredCheck({ id, group: "Charges & fees", title, records: paid, exceptions, differenceCents: n(key+"Amount"),
      result: exceptions ? `${exceptions.toLocaleString()} claims differ.` : "Recorded amounts match.", method,
      source: "Adjudicated claims · Client and pharmacy pricing", href: "/claims", limit: "Internal record comparison; not bank-confirmed settlement. Differences are absolute and may overlap other checks.", nextStep: exceptions ? "Reconcile claim-level differences with pricing operations." : "Confirm against independent pharmacy settlement records." }));
  }
  claimCheck("spread", "Claim pricing spread", "spread", "Compare total client charges with total pharmacy allowed amounts on every paid claim. Opposing differences cannot cancel.");
  claimCheck("ingredient", "Ingredient charges", "ingredient", "Compare billed ingredient costs with pharmacy allowed ingredient costs on each paid claim.");
  claimCheck("dispensing", "Dispensing fees", "fee", "Compare billed dispensing fees with allowed pharmacy dispensing fees on each paid claim.");
  checks.push(measuredCheck({ id: "cost-share", group: "Charges & fees", title: "Member and plan cost split", records: paid, exceptions: n("split"), differenceCents: n("splitAmount"), result: n("split") ? "Cost shares do not reconcile on all claims." : "Member and plan shares equal the charge.", method: "For each claim, compare plan-paid plus member liability with total billed cost.", source: "Adjudicated claim amounts", href: "/claims", limit: "Tests the accounting identity, not benefit-design accuracy or actual member payment.", nextStep: "Review benefit-design accuracy separately." }));
  checks.push(measuredCheck({ id: "rejected", group: "Charges & fees", title: "Rejected-claim payments", records: n("rejected"), exceptions: n("rejectMoney"), differenceCents: null, result: n("rejectMoney") ? "Rejected claims contain payment amounts." : "No payment amounts on rejected claims.", method: "Check plan, pharmacy and member amounts on rejected transactions for nonzero values.", source: "Rejected claim records", href: "/claims?status=R", limit: "Does not verify bank activity or duplicate submissions.", nextStep: "Investigate any nonzero rejected-claim amounts." }));
  checks.push(measuredCheck({ id: "invoice", group: "Charges & fees", title: "Invoice arithmetic", records: invoices.length, exceptions: differences.filter(v=>v>0).length, differenceCents: differences.reduce((s,v)=>s+v,0), result: differences.some(v=>v>0) ? "Invoice totals require review." : "Issued invoice totals reconcile.", method: "Compare total due with drug cost plus administration fee minus rebate credit on issued, closed-period invoices.", source: "Sponsor invoices", href: "/settlement", limit: "Arithmetic only. Does not prove fee authorization, enrollment accuracy or cash settlement.", nextStep: "Validate invoice inputs against contract and source transactions." }));
  const deductions = contract.rebateAdminFeePmpmCents > 0 || contract.rebatePassThroughBps !== 10000;
  checks.push({ id: "deductions", group: "Rebates & settlement", title: "Rebate retention terms", status: deductions ? "Review" : "Clear", records: 1, exceptions: deductions ? 1 : 0, differenceCents: null, result: deductions ? "Demo terms include a rebate deduction or less than full pass-through." : "Configured terms specify full pass-through without a rebate administration deduction.", method: `Inspect the configured contract: ${contract.rebatePassThroughBps / 100}% pass-through; $${(contract.rebateAdminFeePmpmCents / 100).toFixed(2)} PMPM rebate administration fee. Compare with Glass's zero-retention product policy.`, source: contract.name, href: "/sources", limit: "Contract configuration, not proof of receipts or remittance. Historical demo terms are not the Glass offering.", nextStep: deductions ? "Replace legacy deduction terms with the approved Glass fee and pass-through schedule." : "Reconcile receipts and client entitlements independently." });
  for (const item of [
    { id: "rebate-remittance", title: "Rebates received and returned", source: "Claim-matched manufacturer receipts and sponsor remittances", limit: "Current receipt records do not establish a complete sponsor-specific allocation trail." },
    { id: "affiliate", title: "Affiliate and GPO remuneration", source: "Manufacturer, aggregator and affiliate statements", limit: "No complete external remuneration feed is connected." },
    { id: "bank", title: "Pharmacy payment confirmation", source: "Independent remittance and bank confirmations", limit: "A scheduled payment date is not proof that a pharmacy received funds." },
  ]) checks.push({ ...item, group: "Rebates & settlement", status: "Not verified", result: "Independent evidence needed.", method: "Match external receipts and payment confirmations to the sponsor's ledger and contract, including adjustments and timing.", href: "/settlement", records: null, exceptions: null, differenceCents: null, nextStep: "Connect and reconcile the external evidence before marking this check clear." });
  checks.push(measuredCheck({ id: "exclusions", group: "Evidence", title: "Guarantee exclusion reasons", records: n("excluded"), exceptions: n("missingReason"), differenceCents: null, result: n("missingReason") ? "Some excluded claims lack a recorded reason." : "Excluded claims have recorded reasons.", method: "Check every discount-excluded paid claim for a nonempty reason.", source: "Claim guarantee-exclusion fields", href: "/sponsor#guarantee-heading", limit: "A reason does not prove that the exclusion is contractually valid.", nextStep: "Validate exclusions against signed terms and audit samples." }));
  const missingRates = activeRates.filter(r=>!r.sourceDocumentId || !r.citation?.trim()).length;
  checks.push(measuredCheck({ id: "rate-sources", group: "Evidence", title: "Rate source references", records: activeRates.length, exceptions: missingRates, differenceCents: null, result: missingRates ? "Some active rate records lack a source or citation." : "Active rate records include source references.", method: "Check active client rates for a source-document reference and citation.", source: "Effective-dated client rate schedule", href: "/sources", limit: "Reference presence only; document content and executed-contract authenticity require review.", nextStep: "Compare the referenced schedules with signed contract terms." }));
  checks.push(measuredCheck({ id: "awp-capture", group: "Evidence", title: "Pricing benchmark capture", records: n("awpClaims"), exceptions: n("missingAwp"), differenceCents: null, result: n("missingAwp") ? "Some AWP-priced claims lack a positive captured benchmark." : "AWP-priced claims retain their benchmark.", method: "Require a positive captured AWP total on claims priced using the AWP arm.", source: "Claim benchmark snapshots", href: "/sources", limit: `${n("simulated").toLocaleString()} paid claims use simulated AWP. Captured values are not independently validated prices.`, nextStep: "Reconcile against licensed, independent service-date pricing data." }));
  return { sponsor: sponsor.name, contract: contract.name, checkedAt: new Date().toISOString(), asOf: clock.now.toISOString(), latestClaimAt: raw?.latest instanceof Date ? raw.latest.toISOString() : null, periodStart: PLAN_YEAR_START.toISOString(), checks, scope: "Demo records · Automated checks, not an independent audit" };
}
