# Continuous guarantee position

The sponsor dashboard now recalculates provisional year-to-date positions on each request, using the selected simulation clock. Financial measures use effective-dated client rate records and commercial claims from the configured sponsor and contract. Accepted reversals known at the cutoff remove the original claim. The page shows targets, measured values, favorable margins, eligible counts, and missing data.

The overall effective discount is an AWP-weighted blend of category discount targets. It is a monitoring reference, not a newly inferred contractual overall guarantee. Rebate rate is estimated rebates per eligible prescription against the matching claim-rate floor. Dispensing fees are tested as a ceiling. Category detail remains visible; favorable performance in one category is not permission to offset another category's shortfall. Contract minimum-volume rules and simulated AWP counts are disclosed.

This is not a final credit statement. Rebate accruals are not cash receipts. The existing data does not establish Caremark terms, an approved annual guarantee forecast, or final settlement. No projected guarantee payout is subtracted from the annualized cost on this page. Missing rates, overlapping effective terms, or missing AWP suppress a measured position rather than silently excluding unfavorable records.

## Additional guarantee families

Public contracts and procurement materials provide examples of other measures to configure when they exist in the signed contract:

- Brand, generic, specialty and channel-specific discount guarantees; dispensing-fee limits and minimum rebate rates. Wisconsin's audit describes testing AWP discounts, generic MAC allowances, specialty allowances, and dispensing fees. [Wisconsin ETF audit](https://etf.wi.gov/boards/groupinsurance/2025/11/12/gib13ca).
- Claims processing accuracy, call answer time, abandonment, first-call resolution, member satisfaction, mail-order dispensing accuracy and turnaround, and reporting timeliness. These appear in a public Aetna contract's pharmacy guarantee schedule. Its thresholds are examples, not Glass or Caremark commitments. [Kitsap County contract](https://www.kitsap.gov/BOC_p/Agenda%20Documents/2019_1014_HR_C_KC-541-19%20Aetna%20Insurance%20Company%20AFFIRM.pdf).
- System availability, prior-authorization turnaround, pharmacy issue resolution and mail-service measures. [Hampton performance-guarantee exhibit](https://www.hampton.gov/DocumentCenter/View/14444/Attachment-G---Performance-Guarantees?bidId=).

Sources reviewed September 20, 2026. These illustrate contract structures; they do not establish prevalence rankings or universal standards.

## Next data connections

Service guarantees should show the contractual measurement period, numerator, denominator, target, deadline, exclusions, remedy and evidence. Connect call, mail, program and reporting feeds before showing those as measured. Use the existing reconciliation route for the demo's operational scorecard; no new service successes are fabricated on the dashboard.

Persistent snapshots, period-over-period position changes, forecast uncertainty, and receipt-backed settlement are subsequent extensions. Current positions update on reload and clock changes; they are not a streaming feed.

## Rebate period outlook

The dashboard now groups eligible rebate accruals into monthly or quarterly service periods. Switching the view does not assert or change the contract's reconciliation cadence. A calendar close is shown separately from reconciliation: without claim-matched final results, even closed periods remain unreconciled.

The outlook compares period-specific earned estimates and contractual floors on the same eligible prescription denominator. An adjustable ±5%, ±10%, or ±15% sensitivity gives a rate range and identifies whether that range includes the floor. These are explicit illustrative assumptions, not historically calibrated confidence bounds. They apply to earned-to-date amounts, not future claims. Cash receipts and final settlement are not inferred. The headline rebate position is labeled Unreconciled instead of At target.
