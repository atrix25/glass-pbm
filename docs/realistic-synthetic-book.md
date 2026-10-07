# Longitudinal synthetic employer book

`/operating-demo` now opens a 240-member, January–September 2026 employer book. The original controlled correction flow remains under `?legacy=1` and `cdm_` links. It is **not** silently scaled up or merged with this book. `/versions` links both, with the previous implementation preserved by tag `glass-connected-small-book-4c96f1c`.

## Real versus generated

Real: exact CMS NADAC names, NDCs, units, unit prices, publication/effective dates and source CSV line numbers for fourteen products. `data/realistic-book/prices.json` retains the source SHA-256, retrieval time and selected rows across 2026. `scripts/import-realistic-book-prices.py` regenerates this subset from the original CMS CSV. Claim service dates never use later publications/effective prices. Missing prices produce Not verified, not an imputed amount.

Synthetic: employer, members, household links, ages, enrollment, prescribers, pharmacies, network status, prescription quantities/days supply, tiers, PA/QL rules, authorizations, utilization, reimbursement formula, fees, rebates, guarantee terms and every financial event. No employer calibration or clinical appropriateness validation is claimed. Quantities are data-generation assumptions, not prescribing recommendations. Pediatric examples use inhaler fills for ages six and older; adult specialty examples include different benefit designs.

The fixed seed yields non-users, multiple recurring medicines, occasional fills, refill gaps, retail/mail/specialty, new enrollment, termination, rejected/resubmitted claims, same-day reversals, deductible progress and OOP maximum crossings. Fourteen products are a curated illustration, not a complete formulary. Specialty is a synthetic plan tier, not a licensed classification. No diagnosis/DUR, step-therapy engine, family accumulators or clinical-outcome modeling is included.

## Processing

Chronological per-member events maintain individual deductible/OOP accumulators. Resubmissions are inserted back into date order. Same-day cancellations restore the original accumulator movements before subsequent transactions. Original submissions remain in the ledger with explicit reversal/resubmission links.

Public rates remain strings; quantity × rate rounds once to cents using decimal integer arithmetic. Commercial pricing is an explicit synthetic NADAC-plus formula, not an actual contracted Caremark rate. Benefit allocation is a standalone sandbox processor, not a claim of complete production-engine adjudication.

## Accounting

Each journal entry balances debits and credits. Employer claim liability and fees create receivables; pharmacy remittance and employer monthly collections post separate cash entries. Member copays are assumed paid directly to the pharmacy, so they are not recorded as PBM cash. Claim reversals cancel both unpaid pharmacy liability and administration fees.

Quarterly manufacturer entitlement is accrued on net eligible fills. Quarter two deliberately collects 90%, leaving an open receivable while preserving the employer's full due credit. The brand client guarantee of $40 per net fill includes $30 manufacturer entitlement and $10 PBM-funded top-up. Legitimate top-ups are separately disclosed expense. Quarter three is not due at the September 30 cutoff; expected top-ups remain forecasts until reconciliation. Receipts are batch totals, not individual claim settlement confirmations. This is an illustrative double-entry journal, not a complete GAAP general ledger, tax treatment or bank integration.

Monthly invoices exclude prior cash receipts from invoice composition. Invoice amounts, employer payments and remaining balances are distinct. Working-capital timing is retained; no bank-balance realism claim is made.

## Access and evidence

Claims are searchable and server-paginated at 25 rows; journal entries at 50. Member links open all submissions for that member. Claim drill-down shows its reference price/date/line, enrollment, rule, accumulator before/after, linked postings and rebate batch. Full JSON exports preserve every member, claim, journal entry and verification result.

Authenticated demo-gated `/api/realistic-book` stores compressed `rbk_` AssuranceRun records, isolated by tenant and selected sponsor. It uses deterministic generation, idempotent creation, integrity hashes, historical record cutoffs and origin checks. Pinned clocks cannot create books. No operational claim, payment, proposal or staff queue is modified.

`tests/realistic-book.test.ts` covers independent expected benefit amounts, source chronology, reversals, accumulator continuity, seeded malformed outputs, partial receipts, full employer credit, invoice/payment separation and reproducibility. Record-level checks independently validate the generated book; they do not prove an empirically representative population or unrestricted zero leakage.
