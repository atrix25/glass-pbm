# Caremark small-employer offering

Glass demonstrates a proposed Caremark offering for small employers. The product priorities are manageable employer cost, member affordability, simpler administration, accountable service, and economical delivery through agents and deterministic tools. It is not an announced Caremark product or a live Caremark integration.

## Commercial demonstration

`/sponsor`, `/offering`, and `/business` share an illustrative, versioned PMPM model. Inputs live in URL parameters and are normalized on the server. Defaults: 250 covered lives, $100 employer budget PMPM, $145 acquisition benchmark, $11 pharmacy compensation, $156 independent client drug price, $42 expected manufacturer rebates, $40 rebate floor, $9 service fee, $4 staff, $1.50 technology, and $1 allocated overhead. These are invented planning assumptions, not observed benchmarks or Caremark terms. The 1–1,000 member input range is a demo limit, not a legal small-group definition.

The TrueCost concept derives gross cost from acquisition plus pharmacy compensation. The drug-level rebate concept uses the independently specified client drug price. Neither formula is represented as the actual TrueCost rate schedule. Both credit 100% of modeled manufacturer rebates and assess fees separately. The guarantee is an explicit synthetic rebate floor and is not asserted to be part of either Caremark product. A shortfall remains PBM-funded. Negative employer net cost is retained as a credit.

Benefits vary aggregate member share (25%, 20%, 15%) without inventing changes in utilization, network, formulary, clinical outcomes, or member disruption. All figures are 12-month projections for constant enrollment. There is no Caremark realized performance or settlement ledger. Sensitivities change gross cost by ±10% and rebate by ∓15%; these are assumptions, not statistical intervals. Cost-to-serve assumptions and contribution are separate from historical model spend and estimated staff time.

## Workflows and boundaries

The existing claims, eligibility, service, agent, benefit replay, clinical, and settlement functions remain reference workflows using Wisconsin/Navitus data. A persistent context banner distinguishes them from the commercial offering. The old dashboard is retained at `/sponsor/reference`. Caremark concept selection does not reprice, alter or relabel those claims. Actual onboarding automation, Caremark approved rate cards, live service metrics, acquisition costs, affiliate economics and integrations remain outside this prototype.

Reference agent totals distinguish recorded runs, consequential proposals (historical, not pending) and estimated staffing time. Responsible roles are displayed without inventing employee assignments. The offering is behind the existing demo gate; no new mutation endpoint or database migration is introduced.

## Sources and preservation

- [Caremark TrueCost](https://business.caremark.com/what-we-do/transparency/truecost.html)
- [Drug-level rebate options](https://business.caremark.com/insights/2025/unmasking-true-costs.html)

These support the product direction, not the demonstration rates. A 100% rebate commitment is the user's product requirement, not a declaration of universal legal applicability.

The full leakage application remains at the `rebate-monitoring-platform` release/tag and `codex/rebate-monitoring-platform` branch. This change starts from `codex/restore-pre-leakage`; no archived work or database records are removed.
