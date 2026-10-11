/** Illustrative commercial planning only. No claims, contracts or payments are changed. */
export const OFFERING_VERSION = 'caremark-concept-v1';
export type PricingModel = 'truecost' | 'drug-rebate';
export type BenefitPackage = 'core' | 'balanced' | 'choice';
export const PACKAGES = {
  core: { name: 'Core', memberShareBps: 2500, summary: 'Lower employer cost; higher member share.' },
  balanced: { name: 'Balanced', memberShareBps: 2000, summary: 'A middle ground for employer and member costs.' },
  choice: { name: 'Member first', memberShareBps: 1500, summary: 'Lower member share; higher employer cost.' },
} as const;
export type OfferingInput = {
  model: PricingModel; benefits: BenefitPackage; members: number; budget: number;
  acquisition: number; pharmacy: number; drugPrice: number; rebate: number;
  guarantee: number; fee: number; labor: number; platform: number; overhead: number;
};
export const DEFAULT_OFFERING: OfferingInput = {
  model: 'truecost', benefits: 'balanced', members: 250, budget: 100,
  acquisition: 145, pharmacy: 11, drugPrice: 156, rebate: 42,
  guarantee: 40, fee: 9, labor: 4, platform: 1.5, overhead: 1,
};
export type Query = Record<string, string | string[] | undefined>;
export function parseOffering(query: Query): OfferingInput {
  const result = { ...DEFAULT_OFFERING };
  result.model = query.model === 'drug-rebate' ? 'drug-rebate' : 'truecost';
  result.benefits = query.benefits === 'core' || query.benefits === 'choice' ? query.benefits : 'balanced';
  for (const key of Object.keys(DEFAULT_OFFERING) as (keyof OfferingInput)[]) {
    if (key === 'model' || key === 'benefits') continue;
    const raw = query[key];
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const number = Number(raw);
    if (!Number.isFinite(number)) continue;
    result[key] = key === 'members' ? Math.max(1, Math.min(1000, Math.round(number))) : Math.max(0, Math.min(10000, Math.round(number * 100) / 100));
  }
  return result;
}
export function offeringQuery(input: OfferingInput) {
  return new URLSearchParams(Object.entries(input).map(([key, value]) => [key, String(value)])).toString();
}
const cents = (dollars: number) => Math.round(dollars * 100);
export function calculateOffering(input: OfferingInput) {
  const gross = input.model === 'truecost' ? cents(input.acquisition) + cents(input.pharmacy) : cents(input.drugPrice);
  const member = Math.round(gross * PACKAGES[input.benefits].memberShareBps / 10000);
  const rebate = cents(input.rebate);
  const topUp = Math.max(0, cents(input.guarantee) - rebate);
  const fee = cents(input.fee);
  const net = gross - member - rebate - topUp + fee;
  const operating = cents(input.labor) + cents(input.platform) + cents(input.overhead);
  const contribution = fee - operating - topUp;
  const annual = (pmpm: number) => pmpm * input.members * 12;
  // Sensitivity assumptions, not confidence intervals or recorded savings.
  const scenario = (costBps: number, rebateBps: number) => {
    const price = Math.round(gross * costBps / 10000);
    const memberCost = Math.round(price * PACKAGES[input.benefits].memberShareBps / 10000);
    const receipts = Math.round(rebate * rebateBps / 10000);
    const guaranteePayment = Math.max(0, cents(input.guarantee) - receipts);
    return { employer: annual(price - memberCost - receipts - guaranteePayment + fee), contribution: annual(fee - operating - guaranteePayment), guaranteePayment: annual(guaranteePayment) };
  };
  return { gross, member, rebate, topUp, fee, net, operating, contribution,
    employerAnnual: annual(net), memberAnnual: annual(member), feesAnnual: annual(fee),
    rebatesAnnual: annual(rebate), topUpAnnual: annual(topUp), contributionAnnual: annual(contribution),
    operatingAnnual: annual(operating), budgetAnnual: annual(cents(input.budget)),
    favorable: scenario(9000, 11500), adverse: scenario(11000, 8500),
  };
}
