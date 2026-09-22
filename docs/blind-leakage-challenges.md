# Blind leakage challenges

`/leakage-challenges` is an isolated demo workflow owned by **Quality assurance · Finance controls**. The registered `leakage-challenge` agent uses deterministic, seeded fault injection, not an LLM. It never modifies operational claims, payments, benefits, proposals or agent queues.

## Workflow

1. Create a synthetic book (200 or 1,000 claims). A fresh server-generated seed selects fault locations and amounts. The prepared run contains altered evidence, its hash, a private answer and a salted SHA-256 commitment to that answer. The response does not include the seed, salt, original records or expected errors.
2. Run the existing rebate detector through a narrow function accepting only `Evidence` and cutoff. Its source imports neither the injector nor the answer key. The execution query selects only input, hash, cutoff and prior-score state.
3. Compare frozen findings with the private answer in a separate evaluator. Store the detector output and score atomically and immutably. Only a scored run reveals the answer and before/after records.

Creation keys and repeated evaluation are idempotent. Sponsor and tenant filters apply to every lookup. Only authenticated demo staff can use the API; mutations require same-origin requests. The demo feature gate is required. Records use the dedicated `LeakageChallenge` table with no operational foreign keys. Synthetic evidence cutoff is separate from wall-clock preparation and scoring timestamps.

## Faults and controls

Omitted submissions, partial manufacturer payments, duplicate submission lines, uncorrected reversals, missing employer credits, missing eligibility and omitted whole source records are included. Wisconsin additionally tests incorrect noncash guarantee credits. Negative controls include clean settled claims, normal collection timing, and client guarantees without manufacturer entitlements. Terms, eligibility and dollar amounts are synthetic assumptions, not actual Tennessee or Wisconsin contract rates.

The whole-source omission is a known uncovered case. Removing a claim and all of its associated records cannot be discovered from internal joins alone. It remains a scored miss and is unquantified, not portrayed as proven lost cash. This prevents a misleading perfect score that excludes known coverage gaps.

## Scoring

- Match by claim and exception type; compare integer cents separately.
- Detected: matching claim, type and amount, including explicit null for an unquantified exception.
- Amount mismatch: matching claim and type with incorrect amount.
- Missed: no matching finding.
- Unexpected alert: no matching injected error, including duplicate alerts.
- Each finding can be matched once. Timing and contractual economics observations are not error alerts.
- Detection rate counts type matches; exact rate additionally requires the correct amount. Alert precision uses matched alerts. Clean-claim false-positive rate uses distinct clean claims flagged divided by all clean claims.

No rate estimates production performance. No detected amount is counted as recovered or prevented loss. There is no aggregate dollar-savings claim because the different errors can concern different obligations.

## Limits and reproducibility

This is logical code-path separation within one application, not a separate security domain or independent third-party audit. Application/database administrators can access the stored answer. The salted hash commits the answer before execution but does not make the storage immutable against administrators. Fault families are authored in advance; hidden locations and amounts do not establish generalization to all unknown failure modes.

Scored JSON exports include the seed, salt, input, original/altered records, frozen detector output, version and score. Reproduce with `inject(sponsor, seed, salt, originalClaimCount, faultCount)` from `injector.ts`, then pass only its `input` and `cutoff` to `runDetector`. Save/export old runs before changing generator versions. Current injector version is represented by `blind-input-v1` and `challenge-key-v1`; detector is `rebate-detector-v1`.

Tests cover clean controls, varying seeds, missed cases, exact amounts, hand-authored scoring expectations, duplicate alerts, answer withholding, integrity tampering, idempotence, scope isolation, demo/auth/origin gates and size bounds. Next proof stages require independent challenge authors, separate execution credentials/processes, actual contract exhibits and complete external source totals.
