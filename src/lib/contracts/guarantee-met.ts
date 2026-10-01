/**
 * Whether an Exhibit C pricing guarantee binds for a category.
 *
 * The Wisconsin (and Michigan) contracts require a minimum claim count before
 * a channel/drug-class guarantee is in effect. Categories under that floor
 * still show an actual-vs-guaranteed discount for transparency, but they must
 * not be scored as met or missed — otherwise early-year / low-volume channels
 * report as "short of guarantee" when the promise does not bind yet.
 */

export function pricingGuaranteeMet(
  discountVarianceBps: number | null,
  claims: number,
  minClaimsPerCategory: number,
): boolean | null {
  if (discountVarianceBps == null) return null;
  if (claims < minClaimsPerCategory) return null;
  return discountVarianceBps >= 0;
}
