/** Integer-cent, deterministic accounting. This module never writes operational data. */
export type Path = "Baseline" | "Glass";
export type Cadence = "Monthly" | "Quarterly";
export type Claim = { id: string; drug: string; channel: string; tier: number; pa: boolean; serviceAt: string; reversed: boolean };
export type Term = {
  id: string; version: number; side: "Manufacturer" | "Client"; effectiveFrom: string; effectiveTo: string;
  drug: string; channel: string; tier?: number; pa?: boolean; excluded: boolean; cents: number;
  submissionDays: number; cadence: Cadence; offsets: "None"; citation: string;
};
export type Scenario = {
  id: string; title: string; description: string; cause: string; control: string;
  failedClaims: number; expectedManufacturerCents: number; guaranteeCents: number;
  plannedGuaranteeExpenseCents: number; extraCreditCents: number;
  review: "Contract interpretation" | "Benefit activation" | "Payment correction" | null;
  beneficiary: "PBM" | "Employer" | "Neither";
};
export type Snapshot = {
  version: 1; scenario: Scenario; anchor: string; cadence: Cadence;
  claims: Claim[]; terms: Term[]; forecast: { manufacturerCents: number; guaranteeExpenseCents: number; frozenAt: string };
  assumptions: string[];
};
export type Event = {
  id: string; path: Path | "Agent"; kind: string; claimId: string | null; termId: string | null;
  evidenceId: string | null; amountCents: number; serviceAt: string; recordedAt: string;
  settledAt: string | null; detail: string;
};
export const OWNER = "Rebate operations · Finance";
export const STAGES = ["Detected", "Prepared", "Accepted", "Settled"] as const;
export const DAYS = [60, 75, 90, 120];
export function day(anchor: string, n: number) { return new Date(Date.parse(anchor) + n * 86400000).toISOString(); }
export function period(date: string, cadence: Cadence) {
  const d = new Date(date); return cadence === "Monthly" ? date.slice(0, 7) : `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth()/3)+1}`;
}
export function obligation(claim: Claim, terms: Term[], side: Term["side"]) {
  const matches = terms.filter(t => t.side === side && t.effectiveFrom <= claim.serviceAt && t.effectiveTo >= claim.serviceAt &&
    (t.drug === "*" || t.drug === claim.drug) && (t.channel === "*" || t.channel === claim.channel));
  if (matches.length !== 1) return null;
  const term = matches[0];
  const eligible = !claim.reversed && !term.excluded && (term.tier === undefined || term.tier === claim.tier) && (term.pa === undefined || term.pa === claim.pa);
  return { cents: eligible ? term.cents : 0, eligible, term };
}

export type Position = {
  verified: boolean; earnedCents: number | null; entitlementCents: number | null;
  receiptsCents: number; employerCreditsCents: number; topupCents: number;
  expectedGuaranteeCents: number; unexpectedGuaranteeCents: number | null;
  operationalLossCents: number | null; collectionExposureCents: number | null;
  overdueCents: number | null; unresolvedCents: number | null; settled: boolean;
};
export function position(s: Snapshot, events: Event[], path: Path, cutoff: string): Position {
  const visible = events.filter(e => e.path === path && e.recordedAt <= cutoff && (!e.settledAt || e.settledAt <= cutoff));
  const claims = s.claims.filter(c => c.serviceAt <= cutoff);
  const values = claims.map(c => ({ c, manufacturer: obligation(c, s.terms, "Manufacturer"), client: obligation(c, s.terms, "Client") }));
  const verified = values.length > 0 && visible.some(e => e.kind === "Entitlement") && values.every(v => v.manufacturer && v.client);
  const earned = values.reduce((n,v) => n + (v.manufacturer?.cents ?? 0),0);
  // A failed benefit rollout can forfeit otherwise available manufacturer entitlement.
  const forfeited = visible.filter(e => e.kind === "Forfeited").reduce((n,e) => n+e.amountCents,0);
  const receipts = visible.filter(e => e.kind === "Receipt").reduce((n,e) => n+e.amountCents,0);
  const topup = visible.filter(e => e.kind === "Guarantee payment").reduce((n,e) => n+e.amountCents,0);
  const credits = visible.filter(e => e.kind === "Employer credit").reduce((n,e) => n+e.amountCents,0);
  const settled = visible.some(e => e.kind === "Reconciliation closed");
  // Contractual obligation is evaluated by period; offsets across periods are prohibited.
  const periods = [...new Set(values.map(v => period(v.c.serviceAt, s.cadence)))];
  const entitlement = periods.reduce((total,p) => {
    const members = values.filter(v => period(v.c.serviceAt,s.cadence) === p);
    const guaranteed = members.reduce((n,v)=>n+(v.client?.cents??0),0);
    const collected = visible.filter(e=>e.kind === "Receipt" && period(e.serviceAt,s.cadence)===p).reduce((n,e)=>n+e.amountCents,0);
    return total + Math.max(guaranteed,collected);
  },0);
  const losses = visible.filter(e => ["Collection loss","Excess payment","Forfeited"].includes(e.kind)).reduce((n,e)=>n+e.amountCents,0);
  const open = Math.max(0,earned-forfeited-receipts-(settled?visible.filter(e=>e.kind==="Collection loss").reduce((n,e)=>n+e.amountCents,0):0));
  return {
    verified, earnedCents: verified ? earned-forfeited : null, entitlementCents: verified ? entitlement : null,
    receiptsCents: receipts, employerCreditsCents: credits, topupCents: topup,
    expectedGuaranteeCents: s.forecast.guaranteeExpenseCents,
    unexpectedGuaranteeCents: verified && settled ? Math.max(0,topup-s.forecast.guaranteeExpenseCents) : null,
    operationalLossCents: verified ? losses : null, collectionExposureCents: verified ? open : null,
    overdueCents: verified ? (cutoff > day(s.anchor,120) ? open : 0) : null,
    unresolvedCents: verified ? Math.max(0,entitlement-credits) : null, settled,
  };
}
export function comparison(s: Snapshot, events: Event[], cutoff: string) {
  const baseline = position(s,events,"Baseline",cutoff), glass = position(s,events,"Glass",cutoff);
  const proven = baseline.verified && glass.verified && baseline.settled && glass.settled;
  const incrementalReceiptsCents = Math.max(0,glass.receiptsCents-baseline.receiptsCents);
  const avoidedExcessCents = events.filter(e=>e.recordedAt<=cutoff && e.kind==="Excess payment").reduce((n,e)=>n+(e.path==="Baseline"?e.amountCents:-e.amountCents),0);
  return { baseline, glass, recognizedBenefitCents: proven ? incrementalReceiptsCents+avoidedExcessCents : 0,
    incrementalReceiptsCents: proven ? incrementalReceiptsCents : 0,
    guaranteeReductionCents: proven ? Math.max(0,baseline.topupCents-glass.topupCents) : 0,
    employerBenefitCents: proven ? Math.max(0,glass.entitlementCents!-baseline.entitlementCents!) : 0,
    pbmBenefitCents: proven ? Math.max(0,baseline.topupCents-glass.topupCents)+avoidedExcessCents : 0,
    proven,
  };
}
