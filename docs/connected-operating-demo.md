# Connected operating demonstration

## Version preservation

- Historical task fork: `01a10f78-28d5-7593-ac07-1c8545d1b9b6`, “Glass historical baseline — public data checks”.
- Historical Git tag: `glass-public-data-baseline-cd9d126`, commit `cd9d126`.
- New work branch: `codex/glass-connected-demo`.
- `/versions` links the current experience, preserved public-source workflows and historical source. The historical code is not a separate hosted deployment.

## Experience

`/operating-demo` is the new primary demonstration workspace, linked from the welcome page, sidebar and operational assurance. Overview, Benefit design, Claims, Work, Money, Member service and Proof all consume the same persisted run. Previous operational and public-source routes remain accessible.

Cedar Works is a fictional 100-member employer. All terms, prices, receipts, claims, names and financial results are synthetic. No public contract is used as the authority for these obligations. Sponsor selection scopes saved runs without associating this fictional employer with Tennessee or Wisconsin contracts.

The run starts with 100 claims. Ten contain an omitted all-in cash-price cap and a stale copay after a fictional amendment. Ninety are unchanged controls. The existing `priceClaim` function supplies lesser-of pricing. Cost-share allocation, work routing and settlement are deterministic sandbox processors, not model-driven agents. Coverage, clinical safety, accumulators and actual access outcomes are outside scope.

## Flow

1. Inspect the forecast and exact synthetic amendment.
2. Run checks. Compare actual configuration with the amendment and prepare correction.
3. Record simulated Benefits / Finance approval or rejection. Rejection changes no claim.
4. Apply correction. Change configuration, reprice claims, post original offsets and replacements, adjust the employer invoice and create pending recovery/refund entries.
5. Separately simulate external settlement. Approval alone never establishes payment.
6. Verify independent expected results. Failed tests cannot set `Verified`.

Expected results: employer invoice $4,570 → $4,350; $220 employer credit; $200 member refunds; $420 pharmacy recovery. The recovery funds both benefits and must not be counted again. $50 manufacturer receipts remain fully credited to the employer; fees remain $200. No annualized, medical or actual Caremark savings are claimed.

Original source claims are immutable. Evidence includes all changes, simulated reviewer identity (or explicit absence), execution times, ledger entries and verification checks. Member-service answers read the claim and settlement status; they are explicitly scripted responses to three defined questions, not a live call or unrestricted conversation.

## Isolation

Authenticated, demo-gated `/api/operating-demo` persists tenant/sponsor-scoped `cdm_` AssuranceRun records. It uses origin guards, optimistic revisions, payload integrity checks and idempotent commands. It never writes operational claims, agent proposals or real payments. Pinned clocks cannot mutate; later recorded states are unavailable to earlier cutoffs.

## Validation

`tests/connected-demo.test.ts` independently checks amounts, unchanged controls, approval rejection, preapproval blocking, pending versus confirmed settlement, failed corrections, duplicate entries, missing reversals and source-driven member responses. Expected outcomes live in the verifier, which repair code cannot import. API verification exercises repeat/concurrent commands, stale revisions, origin checks, sponsor isolation, historical cutoff and export.
