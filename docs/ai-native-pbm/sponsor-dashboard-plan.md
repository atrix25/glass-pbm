# Plan sponsor dashboard redesign

Status: proposed implementation plan; no application changes made. September 19, 2026.

## Product objective

Help a small-group employer answer: What am I spending? Where will I finish the year? Is Caremark delivering? What should I change? Are my members better off? Organize around the sponsor's 20 questions, with transparent TrueCost or drug-level rebate economics and 100% rebate pass-through. Keep administration fees separate and visible.

The sponsor should understand the account in one minute, investigate a concern in a few clicks, and leave with an explicit next action. Chat is optional assistance, not the only way to discover an answer.

## Three UI options

### A. Executive overview with six focused workspaces — recommended

An overview leads with four measures: all-in net plan PMPM, year-end forecast versus comparator, contractual delivery status, and member OOP burden. Each opens supporting detail. Below, a wide actual-to-forecast trend sits beside the three most important decisions or exceptions. A compact delivery summary covers rebates, service, clinical value, and reporting deadlines.

Navigation: Overview; Cost & trend; Forecast & decisions; Guarantees & value; Rebates; Members; Compliance. Six workspaces support the overview without putting 20 cards on the landing page.

```text
Employer / plan year / pricing model       As of / data freshness
Overview | Cost | Forecast | Value | Rebates | Members | Compliance

Net PMPM       Year-end forecast       Contract delivery       Member OOP
vs comparator  range and variance      priced + service       trend / burden

Actual spend ───────── Forecast band   Decisions needing attention
Budget OR book benchmark              impact / confidence / next action

Rebate reconciliation   Clinical value   Reporting deadlines
```

Best for an owner, finance lead, or HR administrator who checks periodically. Strong hierarchy, quick status, and enough depth for a broker. Tradeoff: scenario modeling needs a separate workspace. The overview prioritizes questions C1, C3, F5, G1–G2, R1, M1; the workspaces cover all 20 below.

### B. Decision and forecast workspace

Lead with a full-width year-end forecast and a waterfall explaining the change from last forecast. A left rail lists current assumptions, upcoming drug events, and regulatory developments. A right comparison pane shows current plan versus up to two alternatives, with net plan cost, member OOP, utilization, disruption, fees, and confidence side by side. A bottom section retains actuals, guarantee status, and rebate reconciliation.

```text
Current plan / saved scenario / compare / review assumptions
Actual year to date ───────── Forecast to year end
Why forecast changed: enrollment / price / mix / rebates / credits

Upcoming events       Current plan | Alternative A | Alternative B
Scenario controls    Cost / utilization / member impact / uncertainty

Contract delivery    Rebate receipts    Member and reporting exceptions
```

Best for renewal, benefit design, and broker consultations; makes all five forecasting questions central. Tradeoff: higher cognitive load and greater dependence on forecast, pipeline, and program-effect data. It can overwhelm a small employer during routine monitoring. All six workspaces remain reachable; it changes the landing page hierarchy, not coverage.

### C. Monthly sponsor brief with an action inbox

Lead with a dated, evidence-backed brief: what changed, why, what to expect, and what needs a decision. Each statement opens its calculation or evidence. Under the brief, show a ranked action list with estimated net impact, member impact, due date, owner, and status. Six expandable topic sections expose the same underlying measures and trends.

```text
Your benefit this month                         Download sponsor brief
What changed  |  What is ahead  |  What needs your attention

Action                         Impact / confidence / owner / due date
Review alternative program     Compare → request review → track outcome
Resolve rebate variance        Evidence → assign owner → track payment

Cost / Forecast / Value / Rebates / Members / Compliance
```

Best for time-constrained small employers; most compatible with agent-assisted account service. Tradeoff: the narrative can hide material detail or become untrustworthy without stable metrics and citations. Generate the brief from governed metrics, use deterministic fallback copy, and expose missing data. Never let a generated recommendation publish plan changes or move funds.

Recommendation: build A as the stable home, use B inside Forecast & decisions, and add C's brief and action list once the underlying measures are reliable. These are composable interaction patterns rather than three separate products.

## Coverage of all 20 questions

Identifiers are stable for design and acceptance testing. Every answer has a headline conclusion, supporting measure, comparison period, provenance, and next action where appropriate.

### Core trend and historical performance

- **C1 — PMPM and budget:** all-in net plan PMPM, YTD dollars, and variance to employer-entered budget. If absent, offer a matched book-of-business benchmark, explicitly labeled as a benchmark, not budget. Show cohort, period, funding/pricing basis, and comparability limits; if unavailable, offer budget entry without inventing a target. Home: Overview / Cost.
- **C2 — Cost and utilization over time:** aligned monthly cost and utilization panels; net PMPM, scripts per 1,000 member-months, covered lives, and days-supply-normalized use. Compare equal periods, distinguish partial months, and show prior year only when available. Home: Cost.
- **C3 — Drivers and actions:** price, utilization, mix, membership, fees, and rebate bridge, with specialty and therapeutic-class drilldowns. Rank potential actions by net savings, clinical suitability, member disruption, confidence, and effort. Home: Cost, linking to Forecast.

### Forecasting

- **F1 — Current-plan forecast:** monthly projected cost and utilization with annual total and uncertainty range, pinned to current plan, formulary, enrollment, and pricing versions. Home: Forecast.
- **F2 — Macro developments:** dated event list showing affected population, expected mechanism, scenario impact, uncertainty, and source. Proposed rules remain distinguishable from enacted or effective requirements. Home: Forecast, linked to Compliance.
- **F3 — Drug events:** biosimilar entry, patent/competition expectations, and pricing inflation timeline with affected drugs, utilization, net cost exposure, adoption assumptions, and timing uncertainty. Patent expiry alone does not imply an available substitute. Home: Forecast.
- **F4 — Alternatives:** compare current plan and candidate configurations/programs across net plan cost, utilization, member OOP, access/disruption, program fees, and confidence. Save scenarios and request authorized review. Home: Forecast.
- **F5 — Year-end net cost:** reconcile YTD experience plus remaining-year forecast, fees, expected rebates, and eligible guarantee credits/other payouts. Show before-credit and after-credit totals, settlement timing, and uncertainty; include each credit once. Home: Overview / Forecast.

### Guarantees and value delivery

- **G1 — Pricing guarantees:** generic, brand, and specialty scorecard, further segmented by contractual channel/category, with target, eligible denominator, actual, exclusions, variance, measurement period, and estimated versus settled credit. Home: Value.
- **G2 — Operational guarantees:** call response and resolution, account-service responsiveness, and other contracted SLAs; target versus actual, breaches, owner, and credit eligibility. Missing telemetry is not a passing status. Home: Value.
- **G3 — Clinical program impact:** eligible, enrolled, engaged, and completed populations; adherence/outcome changes, fees, gross and net estimated impact, and evaluation method. Separate observed change from attributable effect. Home: Value, linked to Members.
- **G4 — Integrated CVS medical/PBM value:** matched or risk-adjusted comparison of combined medical and pharmacy cost and outcomes, including incremental program cost and selection limitations. Require linked medical data and a defensible comparator before claiming outsized benefit; otherwise state that impact is not yet measurable. Home: Value.

### Rebate transparency

- **R1 — Rebates owed and received:** lifecycle from earned estimate to invoiced, received, allocated, and paid/credited; contractual entitlement, outstanding/overdue amounts, drug-level drilldown, and 100% pass-through reconciliation. Member POS credits and employer payments cannot count the same dollars twice. Home: Rebates / Overview exceptions.
- **R2 — Additional rebate opportunity:** compare eligible formulary/pricing alternatives, with incremental rebates, gross cost, net cost, member impact, and clinical constraints. A higher rebate is not automatically better value; no implication of guaranteed availability. Home: Rebates, linking to Forecast.

### Regulatory

- **L1 — Data and reports:** applicability-aware checklist by funding arrangement, jurisdiction, and plan type; required report, reporting period, data completeness, owner, due date, export, and submission receipt where available. Do not imply all small employers require every state or CMS report. Home: Compliance.
- **L2 — Upcoming member impact:** regulatory calendar with authority/status, effective date, applicable groups, network/access or benefit implications, owner, and action. Share the event record with F2 to avoid contradictory timelines. Home: Compliance.

### Member experience

- **M1 — Out-of-pocket burden:** total and per-member OOP, per-fill distribution, higher-burden share, and trend by suitable cohort; distinguish recorded claims liability from confirmed payment when necessary. Home: Overview / Members.
- **M2 — Adherence:** defined PDC measures, eligible denominators, measurement windows, class-level trends, and gaps in therapy, with enrollment and data-completeness limits. Claims-based adherence is not proof of ingestion. Home: Members.
- **M3 — Access and use:** digital adoption, retail/mail/specialty use, network access, fulfillment and friction indicators. Channel mix is not evidence of digital adoption or geographic access; those require telemetry and geography/network feeds. Home: Members.
- **M4 — Health outcomes:** condition-level outcomes, available clinical measures and medical utilization, plus cohort/methodology notes. Display validated proxies separately from observed clinical outcomes. Home: Members / Value.

## Shared measurement and interaction contract

- Persist employer, plan year, reporting window, contract version, pricing model, and comparison basis across workspaces. Display as-of date and source freshness per metric.
- Calculate PMPM using eligible member-months with a documented partial-month convention. Numerator includes applicable fees and adjustments; distinguish accrued economic cost from cash paid. Use the same basis for budget, benchmark, history, and forecast comparisons. Show PBM service fees separately from total pharmacy benefit cost.
- Reconcile reversals and adjustments. Identify claims maturity and partial periods. Show estimates, forecasts, received cash, and settled guarantees with distinct labels.
- Separate baseline forecast, event assumptions, alternatives, and retrospective actuals. Version inputs and avoid double-counting interacting savings, rebate effects, and guarantee recoveries. Use ranges supported by the model; uncalibrated low/base/high scenarios are not statistical confidence intervals.
- Every recommendation explains expected impact, evidence, dependencies, downside/member effect, confidence, and approval path. Disposition: investigate, simulate, request review, approve through authorized workflow, or dismiss with reason.
- Protect small-group privacy through authorized aggregation, minimum cohort sizes, complementary suppression, and export/drilldown controls. Sponsor access does not automatically permit named member health details.
- Missing, stale, inapplicable, suppressed, and unsupported data are distinct states, never zero or green. A missing-data state explains the required source and accountable owner.
- Accessible keyboard navigation, readable chart alternatives, non-color status labels, mobile summary layout, and exportable sponsor summaries are part of the design.

## Current implementation assessment

Inspected `src/app/(app)/sponsor/page.tsx`, `src/lib/queries/sponsor.ts`, and relevant Prisma models. Existing daily rollups support spend, claims, estimated rebates, member liability, monthly trends, and drug/channel/class cuts. These can seed C1–C3 and parts of R1 and M1/M3 after measure corrections.

The current headline subtracts estimated rebates and calls the result net plan cost without including separately displayed administration fees. PMPM divides by a total member count and elapsed months rather than eligibility-based member-months. Administration fees on the page use a full-year multiplier. These mixed bases must be corrected before comparisons or forecasts are presented.

Contract, rebate accrual/invoice, sponsor invoice, eligibility, and service-incident models offer partial foundations. Their existence does not establish complete Caremark guarantee or cash-reconciliation coverage. Validate semantics and source completeness before reuse.

New data/modeling work is needed for employer budgets, matched book benchmarks, versioned forecasts, market-event assumptions, scenario evaluation, operational SLA telemetry, program evaluation, integrated medical value, digital usage, outcomes, and applicability-aware reporting. Do not seed those as apparently observed Caremark performance.

Remove Navitus/Wisconsin terms from target-product copy; retain any historical fixture provenance in a clearly labeled demo context. Do not relabel historical calculations as actual TrueCost results.

## What moves out of the overview

Move pricing-arm winners, NCPDP codes, NADAC/margin decomposition, raw claim ledger entry points, benefit-level tables, detailed channel mix, raw rejection codes, contract excerpts, and test-harness proof links into relevant drilldowns or an audit area. Keep significant member access failures as an exception summary. Preserve traceability without letting operational detail compete with sponsor decisions.

## Implementation sequence

1. **Approve the information hierarchy and metric dictionary.** Use A as the planning default. Finalize definitions for net cost, member-months, budget/benchmark, rebates, guarantee credits, and forecast. Specify each question's source, owner, availability, and unsupported state. Acceptance: all 20 identifiers mapped, no ambiguous cost or rebate labels.
2. **Build the sponsor shell and correct historical measures.** Read relevant installed Next.js guides before implementation. Refactor the existing sponsor page into overview and focused workspaces; keep database reads in query modules and use rollups where valid. Add employer budget entry and a comparator selector. Acceptance: totals reconcile, partial periods are labeled, empty enrollment does not divide by zero, and unavailable benchmarks are not fabricated.
3. **Deliver contract and rebate accountability.** Integrate validated settlement, rebate, and SLA sources; add category guarantees, rebate lifecycle, exclusions, due dates, and evidence drilldowns. Acceptance: estimated versus settled values are distinct, credits are counted once, and pass-through reconciles end to end.
4. **Deliver forecast and scenario decisions.** Implement a deterministic baseline and versioned assumptions, then market/drug events and scenario comparison. Add range, sensitivity, disruption, and net-year-end bridge. Acceptance: saved results reproduce from inputs; changes in enrollment, plan, rebates, fees, and credits flow consistently through projections.
5. **Deliver member, clinical, integrated-value, and compliance detail.** Connect approved telemetry, medical/clinical, program, and regulatory sources. Enforce small-cohort safeguards and applicability. Acceptance: claims proxies are not labeled clinical outcomes, causal savings claims require methodology, and reports show readiness versus actual submission separately.
6. **Add the sponsor brief and action workflow.** Ground every summary in metric records and evidence. Track owner, review, decision, and realized results. Acceptance: agents cannot invent missing facts or execute consequential plan changes from the dashboard.

Phases 3–5 can proceed in parallel once the shared metric contract exists. The shell may expose explicit pending-source states, but a phase is not complete until its promised questions are answered with validated data. No live schema migration, new vendor connection, or application rewrite is authorized by this planning artifact alone.

## Validation and release criteria

- Reconcile headline and drilldown figures against source records, including reversals, partial months, enrollment changes, fees, and zero-member periods.
- Exercise employer budget, available benchmark, and neither-available paths; verify no benchmark is presented as a sponsor commitment.
- Test rebate timing, member credits, duplicate receipts, guarantee eligibility, and credit double counting.
- Backtest forecast behavior when enough history exists; otherwise disclose calibration limits. Freeze time and inputs for reproducibility.
- Test sponsor isolation, small-cohort suppression, restricted exports, stale sources, and unavailable/inapplicable metrics.
- Run a 20-question usability walkthrough with a small-employer finance/HR user and a broker. Verify overview questions resolve in one minute and each detailed answer is reachable within a few interactions.
- Run relevant type, lint, domain, integration, accessibility, and responsive checks; avoid broad database scans or fabricated success states.

## Choices to confirm during design

Preferred landing option; primary sponsor persona; budget entry in annual dollars or PMPM (support both); available historical periods and benchmark cohorts; first Caremark source integrations; and whether initial delivery is an explicitly labeled demonstration or connected operational pilot. Until decided, use A, owner/finance/HR personas, both budget formats, and honest source-availability states.
