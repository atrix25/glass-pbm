export type AssuranceStatus = "Clear" | "Review" | "Not verified";
export interface AssuranceCheck {
  id: string;
  group: "Charges & fees" | "Rebates & settlement" | "Evidence";
  title: string;
  status: AssuranceStatus;
  result: string;
  method: string;
  source: string;
  href: string;
  records: number | null;
  exceptions: number | null;
  differenceCents: number | null;
  limit: string;
  nextStep: string;
}

export function measuredCheck(input: Omit<AssuranceCheck, "status">): AssuranceCheck {
  return { ...input, result: !input.records ? "No eligible records to check." : input.result, status: !input.records || input.exceptions === null ? "Not verified" : input.exceptions > 0 ? "Review" : "Clear" };
}

export function invoiceDifference(invoice: { drugCostCents: number; adminFeeCents: number; rebateCreditCents: number; totalDueCents: number }) {
  return Math.abs(invoice.totalDueCents - (invoice.drugCostCents + invoice.adminFeeCents - invoice.rebateCreditCents));
}
