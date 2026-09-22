# Rebate protection sandbox

The demo proves deterministic control behavior on synthetic fixtures. It does not establish realized Caremark savings, audited results or actual contract terms.

## Experience

Open `/rebate-protection`. Choose one of seven scenarios and monthly or quarterly reconciliation. Advance through detection, preparation, simulated manufacturer response and settlement. Contract interpretation, benefit activation and payment correction require an explicitly labeled simulated review. Rejection preserves the seeded failure; no prevention benefit is credited.

Position summarizes financial exposure and employer delivery. Exceptions provides the responsible role and action history. Proof compares identical claims, contracts and external events under a seeded baseline and Glass controls. All runs remain available through their URLs; the most recent 20 are loaded and seven are linked in the UI. Evidence can be exported from the authenticated GET endpoint. Checkpoints and the global clock suppress subsequent reviews and settlements.

The sponsor Assurance page includes a separate synthetic Rebate delivery card. Existing real-data checks remain unchanged and unverified where evidence is absent. Agent operations registers Rebate protection, with a dedicated sandbox link. `/agents/runs/rbp_*` renders sandbox detail without adding simulated records to operational AgentRun or AgentProposal tables.

## Accounting

All amounts are integer cents. Manufacturer eligibility and client guarantee eligibility are independently evaluated from effective-dated term snapshots. A reversed claim is excluded from both. Missing or overlapping terms are not verified. Pass-through is 100%, with the same separately disclosed $20 administration fee in both paths. Guarantees reconcile by service month or quarter without offsets between periods.

Cash, employer credits and PBM-funded guarantee payments are distinct ledger entries. Excess payments are separate from valid employer entitlement. Attributed benefit is incremental manufacturer cash plus prevented excess payments; an associated reduction in guarantee expense is not added a second time. Detected exposure, accepted submissions and uncollected receivables do not earn benefit credit. Expected guarantee expense is frozen before the run. A contractual mismatch may create unexpected expense but no operational loss; an unfavorable guarantee can remain an expected expense after controls succeed.

The baseline seeds omitted claims, unresolved underpayments and other specific failures. It is not asserted to represent Caremark's actual operations. Benefit-change proof evaluates a proposed tier-3 change against tier-2 manufacturer conditions. A simulated approval accepts the recommendation to retain existing benefits; no operational benefit change is executed. Utilization is held constant, and member cost shifts are never counted as savings.

The illustrative collection schedule uses a submission deadline of day 80, a manufacturer response on day 90 and payment/reconciliation on day 120 from the fixture anchor. These dates are fixture assumptions, not general PBM settlement standards. Monthly/quarterly selection controls guarantee grouping. Open-period ±10% receipt sensitivity is an assumption, not a confidence interval.

## Storage and interfaces

Three additive Prisma models (`RebateSandboxRun`, `RebateSandboxEvent`, `RebateSandboxException`) store immutable contract/claim/forecast snapshots, ledger events and exceptions. No foreign key connects them to operational claims, contracts, payments or proposals. `createdAt` is actual recording time; `serviceAt`, `recordedAt` and `settledAt` are explicit simulated business times. Stage advancement creates events transactionally; read projections filter by cutoff. Future scenario definitions are planned inputs, not reported settled outcomes.

`POST /api/rebate-protection` accepts `create` (scenarioId, cadence, UUID key), `advance` (id, expected stage), and `review` (id, Approved/Rejected). An advisory transaction lock and tenant-scoped request key make creation and repeated transitions idempotent. Contradictory reviews fail. Actions require demo mode, staff demo role, same-origin requests and the deployment's existing authentication gate. `GET` requires an id and optional ISO cutoff. All reads and mutations are tenant-scoped.

Operational guarantee calculations still use legacy book eligibility. The independent term model applies only to these sandbox fixtures; connecting it to actual Caremark processing requires a separate migration and contract-validation project.

## Validation and rollout

Run `npx vitest run tests/rebate-protection.test.ts tests/rebate-sandbox-service.test.ts tests/rebate-api.test.ts tests/agent-work.test.ts tests/agent-catalog.test.ts --reporter=default`, then build. The hand-calculated expected results in `tests/fixtures/rebate-proof-expected.json` are independent of the detector and event generator. Tests cover all seven scenarios with both reconciliation cadences, overlapping terms, missing terms, condition changes, reversals, partial receipts, no duplicate savings, future cutoff suppression, repeated requests, rejected reviews, tenant scoping and feature gating.

Apply the additive schema with `prisma db push --skip-generate` without accepting data loss. Fly's existing startup applies the schema; verify the new tables after deployment. Deploy the app process group only when a background job is active. Smoke-test create/advance/review, the three tabs, the agent-detail route, sponsor Assurance and authentication. Production smoke tests create only labeled sandbox records.

To establish actual savings later, agree on the measurement population, baseline, attribution and reconciliation horizon with Finance before observing results; validate actual manufacturer and client contract terms and complete claim-to-cash source integrations. Do not extrapolate demo results into a Caremark savings percentage.
