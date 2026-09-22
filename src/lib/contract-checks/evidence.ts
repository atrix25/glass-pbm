import type { Evidence } from "./detector";
import type { SponsorKey } from "./profiles";
import tennessee_claims from "./fixtures/tennessee/claims.json";
import tennessee_terms from "./fixtures/tennessee/terms.json";
import tennessee_submissions from "./fixtures/tennessee/submissions.json";
import tennessee_receipts from "./fixtures/tennessee/receipts.json";
import tennessee_credits from "./fixtures/tennessee/credits.json";
import tennessee_guaranteeCredits from "./fixtures/tennessee/guaranteeCredits.json";
import wisconsin_claims from "./fixtures/wisconsin/claims.json";
import wisconsin_terms from "./fixtures/wisconsin/terms.json";
import wisconsin_submissions from "./fixtures/wisconsin/submissions.json";
import wisconsin_receipts from "./fixtures/wisconsin/receipts.json";
import wisconsin_credits from "./fixtures/wisconsin/credits.json";
import wisconsin_guaranteeCredits from "./fixtures/wisconsin/guaranteeCredits.json";
export const DEFAULT_CUTOFF = {tennessee:"2023-03-31",wisconsin:"2024-06-30"} as const;
// Separate immutable source files. No scenario labels or expected findings are supplied.
const inputs:Record<SponsorKey,Evidence> = {
 tennessee: {sponsor:"tennessee",version:"public-contract-test-v1",claims:tennessee_claims,terms:tennessee_terms,submissions:tennessee_submissions,receipts:tennessee_receipts,credits:tennessee_credits,guaranteeCredits:tennessee_guaranteeCredits},
 wisconsin: {sponsor:"wisconsin",version:"public-contract-test-v1",claims:wisconsin_claims,terms:wisconsin_terms,submissions:wisconsin_submissions,receipts:wisconsin_receipts,credits:wisconsin_credits,guaranteeCredits:wisconsin_guaranteeCredits},
};
export function evidenceFor(sponsor:SponsorKey):Evidence { return structuredClone(inputs[sponsor]); }
