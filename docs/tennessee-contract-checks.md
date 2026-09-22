# Tennessee contract checks

The sponsor selector separates two demo profiles: Wisconsin (the existing ETG0013-based employer book) and Tennessee (a new, isolated public-audit demonstration). These are demo contexts, not a replacement for production tenant authorization. `ContractDemoSponsor` and `ContractCheckRun` do not write operational claims, payments, proposals or agent queues. The Tennessee context only exposes its supported pages and check APIs; unrelated workflows redirect or reject requests.

## Source boundary

- Wisconsin: https://etf.wi.gov/sites/default/files/2024-07/Amendment%20%237%20ETG0013.pdf, Amendment 7A, page 3. Humira substitution uses corresponding fill-date WAC differences with matched units; the insulin provision uses a different historical reference. This release tests the Humira-style arithmetic with synthetic drug IDs and supplied WAC values. It does not independently validate an NDC mapping or external WAC source.
- Tennessee: https://www.tn.gov/content/dam/tn/partnersforhealth/documents/archive/2024_audit_monitoring_report_archive.pdf, June 2024 report, page 10, 2022 rebate audit. The annual greater-of obligation is audit-derived. The signed agreement, rate schedules, exclusions and manufacturer contracts have not been acquired. https://www.tn.gov/partnersforhealth/contracts.html directs users to request contract copies.

No audit summary is represented as a complete executed contract. Public audit figures appear only in source context. All transaction data, manufacturer eligibility assumptions, per-claim rates and deadlines in the check inputs are synthetic. Unknown eligibility yields an incomplete position rather than zero loss.

## Independent detection

`detector.ts` takes terms, claims, submissions, receipts, employer credits and noncash guarantee credits. It never imports the sample generator, scenario IDs, published audit finding amounts, or test answer key. It joins evidence and calculates discrepancies in integer cents. Due-date observations, contractual economics and employer obligations are separate from operational exposures. No finding receives savings credit.

The separate `tests/fixtures/contract-check-expected.json` specifies expected amounts. Mutation tests change amounts, identifiers, settlement timing and contract evidence to prove that results are calculated instead of selected by scenario. Tests also cover source conflicts, reversal visibility, order independence, partial collection, orphan records and noncash credits. This is deterministic software detection, not an LLM interpreting a previously unseen contract.

Each page computes checks on load; Run checks & save records an immutable input/result snapshot and exposes the existing agent work-detail route. Refresh does not imply live execution. The check date is a historical evidence cutoff independent of the 2026 operational book clock, capped by that clock. Exports remove future evidence. No correction workflow or real financial movement is implemented.

## Limits

This is a bounded test of implemented rules, not proof that all leakage is absent. Exposure metrics are not additive economic savings. Missing manufacturer exhibits prevent verification of actual rebate entitlements. Collections and reduced PBM-funded guarantee payments cannot both be counted as incremental benefit. Legitimate employer credits remain payable. Annual aggregate greater-of arithmetic is illustrative; channel guarantees, actual offsets and settlement calendars require the executed agreement.

Validation: run `npx vitest run tests/contract-checks.test.ts tests/contract-check-api.test.ts tests/sponsor-isolation.test.ts --reporter=default`, then build. Additive schema deployment follows the existing Fly demo process. The demo feature gate must be enabled.
