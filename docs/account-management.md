# Account management

`/account-management` connects a savings goal and member-impact limits to a recorded benefit proposal, an approved effective-dated release, and seven downstream review requests. Registry responsibility is **Account management · Benefits lead**. Execution is deterministic; no model-generated savings or employee assignments are presented.

The first version evaluates PA, step-therapy and tier changes on three high-cost products. Each option replays the full tenant book through the selected clock cutoff. Results compare the cumulative proposed configuration with the filed plan, not with the previous release, and are historical estimates rather than forecasts. Savings include modeled rebates. Member cost transfers and newly rejected fills are shown separately. Selection prefers the fewest affected members among options meeting all four goals. No eligible option means no proposal. A no-op replay must first reproduce the recorded book.

## Activation

A benefits lead explicitly approves a recommendation after benefit and clinical review. The server rechecks limits, evidence age, future-clock use and baseline version under a transaction lock. Approval creates a cumulative ConfigVersion effective at the next UTC midnight; repeat submissions return the same release. Historical claims and filed configuration stay unchanged. Coverage tools, price estimates, POS simulations and UM views overlay the effective release. This is activation within Glass, not a submission to an external production claims processor.

Seven recorded rollout requests go to existing registry roles. These are delivery records, not assertions that those agents executed work or that employees completed it. A reviewer records follow-through with an evidence/reference note in the audit log. External notices, regulatory review and clinical approval are not automated.

Analysis uses the existing Postgres job worker (`npm run worker`). Only one account-management analysis can be queued or running at a time. The page polls recorded job progress every five seconds. Benefit changes require an authorized session; the existing role-based demo mode also supports synthetic demonstrations.

## Checks

`tests/account-management.test.ts` covers ranking, constraints, cumulative patches and effective dates. `tests/account-activation.test.ts` covers approval, stale/changed evidence, eligibility revalidation and duplicate activation. Engine golden, formulary and determinism suites protect pricing and reproduction.
