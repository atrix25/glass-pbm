# Public data checks

The `/public-data-checks` workspace compares CMS August and September 2026 monthly files for SilverScript Choice (PDP), S5601-024-000, PDP region 12 (Alabama/Tennessee). This is a separate Medicare reference example, not the Tennessee employer contract or that employer's operational data.

## Processing and evidence

1. Compare exact published fields. Formulary version numbers remain in source evidence but are excluded from clinical-change counts.
2. Build a persisted, isolated draft by applying recorded additions, changes and removals to the earlier snapshot. No production configuration is changed.
3. Verify draft fields and population counts independently against original September source records and the Python import census. The verifier does not import processing functions. Changed test copies exercise failures.

NADAC contains only August 26 and September 30, 2026 snapshots for NDCs present in either imported formulary. Publication date and effective date both constrain lookup; rates remain decimal strings. Dated lookup outputs are recorded and independently verified. No interpolation, reimbursement claim, claim quantity or savings calculation is introduced.

Sources, filenames, line numbers, download URLs and SHA-256 digests are retained in the manifest and evidence export. The network digest applies to the original nested ZIP, not to the decompressed text. The filtered row bundle is gzip-compressed and integrity-checked at load.

## Scope limits

- Network records come from partition 6 only. Other partitions were not scanned, so completeness is not established. No network-adequacy conclusion is supported.
- CMS proxy NDCs are not an exhaustive product universe. PA/ST/QL flags do not include full clinical criteria.
- Monthly labels/internal month-end filenames describe published snapshots, not exact coverage-change effective dates. Absent later rows do not prove member coverage was terminated.
- Standard cost-sharing and separately published insulin fields are preserved. Raw type, days-supply and percentage codes follow the linked CMS dictionary.
- Excluded-drug and indication-based files were scanned; their selected populations are recorded even when zero. Zero rows alone do not establish lack of other coverage requirements.
- NADAC is a reference acquisition cost, not this plan's contractual reimbursement obligation.
- There are no claims, rebates, invoices, actual implementation records or settlements in this example. Passing checks establishes selected source-to-draft agreement only.

## Persistence and access

Demo-gated, authenticated `/api/public-data-checks` supports create, build, verify, pagination/search, dated price lookups and evidence export. `pub_` AssuranceRun records are tenant/sponsor scoped with revision checks, command idempotency, immutable source hashes and event times. They never enter operational queues. A pinned clock cannot mutate runs; later recorded states are unavailable to an earlier cutoff.

The selected sponsor scopes private run history; it does not make the external Medicare example part of that sponsor's contract.

## Reproduce

Source URLs and exact component filenames are in `data/public-data-checks/manifest.json`. The original CMS monthly ZIPs are about 2.3 GB each; HTTP range requests can retrieve component ZIPs without downloading each whole archive. `scripts/fetch-public-plan-data.py DIRECTORY` downloads the selected components and NADAC, then filters plan rows from network partition 6. It requires several GB of temporary disk and may take minutes. `scripts/import-public-plan-data.py DIRECTORY` creates the exact selected-row bundle and independent census. No synthetic records are imported.

Run `npx vitest run tests/public-data-checks.test.ts --reporter=default` and `npm run build` before deployment. API integration also exercises concurrent/repeated commands, stale revisions, origin checks, sponsor isolation, cutoffs, pagination and full exports. Test-only altered copies are never presented as real source records.
