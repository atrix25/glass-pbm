# Glass initiative context

Updated September 19, 2026. This document records the initiative direction supplied by the product owner and supersedes broader market assumptions in the original blueprint. It describes a target offering, not an announcement of an available Caremark product or completed integration.

## Product direction

Glass will be part of **CVS Caremark**, focused on selling a **highly automated, more transparent pharmacy benefit offering to small group employers**. Automation should make small accounts economical to acquire, implement, serve, and retain while preserving clinical quality and accountable human decisions.

Support either **CVS Caremark TrueCost** or **Caremark drug-level rebate models** using approved, effective-dated Caremark terms. These are related options: Caremark describes acquisition-cost-based pricing and drug-level rebate visibility for TrueCost, and says drug-level rebate models are available with or without full TrueCost. Do not invent a new pricing formula or treat a published description as an executable rate schedule. Sources: [Caremark TrueCost](https://business.caremark.com/what-we-do/transparency/truecost.html), [Caremark pricing-model explanation](https://business.caremark.com/insights/2025/unmasking-true-costs.html).

**100% rebate pass-through is a launch product requirement for both options.** Rebate retention is zero. Track attributable manufacturer remuneration, including affiliate/GPO flows, so the promise cannot be weakened by relabeling a rebate or routing it through another entity. Service fees are separately contracted and disclosed; they do not reduce rebate entitlement. Rebate forecasts, contractual guarantees, earned accruals, actual receipts, credits, payments, and unpaid balances must be distinguishable.

Employer reporting should explain drug-level economics and reconcile pharmacy costs, service fees, rebates, member contributions, and net plan cost. Small employers receive actionable summaries with controlled access to supporting detail. Shared Caremark ownership does not authorize cross-employer access to claims, contracts, or PHI.

## Delivery model and agent priorities

The 65-process catalog remains the end-to-end accountability map. Each process may be performed by an approved Caremark service, Glass automation, or an authorized person. It does not require 65 independent LLMs or a replacement for every existing Caremark capability.

Prioritize these connected workflows:

1. Qualify employer and broker opportunities; assemble quotes from approved pricing and benefit packages.
2. Turn signed terms into validated configuration; automate enrollment checks, implementation tasks, and launch evidence.
3. Provide grounded employer and member self-service with reliable escalation.
4. Explain drug-level costs and reconcile rebates from source through payment.
5. Monitor service quality, exceptions, cost to serve, retention, and transparent value at renewal.

Deterministic services own calculations and ledger effects. Agents extract, explain, coordinate, investigate, and draft. Approved human or explicitly delegated transactional authority remains required for consequential effects. Actual Caremark interfaces, data rights, service owners, and operating commitments must be identified before deployment.

## CAA and FTC alignment

Treat the product promise and legal obligations as separate, versioned controls. Do not label the current prototype compliant merely because its design includes pass-through.

The CAA 2026 amended ERISA's service-provider rules to address full pass-through of rebates and specified other remuneration, including intermediary arrangements. The text specifies affected plan years beginning at least 30 months after February 3, 2026 and conditions concerning contracts, renewals, and extensions. Determine applicability from plan and contract facts; this is not a universal present-day mandate for every small employer. Glass's launch policy need not wait for a statutory deadline. Source: [29 USC 1108, preliminary text](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title29-section1108&num=0&edition=prelim), subsection (b)(2)(C).

The FTC's July 2026 Caremark announcement describes a **proposed consent order**, including a standard offering with member point-of-sale rebate benefits, an option to move away from rebate guarantees and spread pricing, and transparency provisions. That announcement alone does not establish final-order status or all implementation dates. Record the governing order, finality, deadlines, and applicable offerings before activating legal rules. Source: [FTC Caremark settlement announcement](https://www.ftc.gov/news-events/news/press-releases/2026/07/ftc-secures-major-settlement-caremark-resolving-antitrust-case-against-second-drug-middleman).

Passing rebates to a plan or an issuer on its behalf is distinct from allocating rebates to members at the point of sale. Model the authorized recipient, member election, timing, and reconciliation explicitly. Member credits count once toward plan entitlement; the same dollars cannot also be represented as an additional employer remittance.

## Decisions still to resolve

- Eligible group-size range and launch states; do not assume a universal small-group threshold.
- Supported funding arrangements, including whether insured, self-funded, or level-funded groups are in scope.
- Direct, broker, TPA, carrier, or other distribution channels and their authority.
- Available Caremark configurations, network/formulary packages, fee schedules, guarantees, and member rebate elections.
- Integration ownership, settlement recipients and timing, service commitments, and launch sequence.

The existing Wisconsin ETF / Navitus examples remain historical demo fixtures. Updating this context, the catalog, and the logical model does not migrate live contracts, reprice claims, connect Caremark systems, or change the running application's compliance status.
