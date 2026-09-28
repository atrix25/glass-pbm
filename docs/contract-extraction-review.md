# Public contract extraction review

`/contract-extraction` evaluates real model extraction against a frozen public source. It is linked from Leakage prevention. Staff authentication and the demo gate apply. Runs and all review operations are scoped to tenant and selected sponsor and use isolated `ext_` AssuranceRun records. No operational requirements, benefits, payments or agent proposals are updated.

The initial reference is Wisconsin ETF / Navitus ETG0013 Amendment 1, PDF pages 43, 59, 60, 115 and 139–141. The complete original PDF is preserved under `public/contracts`; extracted source text and its PDF SHA-256 are under `data/contract-extraction`. This is a historical selected-page evaluation, not current pricing, the entire contract package, or Tennessee contract terms. Drug lists and referenced clinical criteria are not inferred.

The page-focused extraction uses Claude Sonnet 4.5 through the existing Anthropic SDK. Each request sees all seven supplied pages as context. `CONTRACT_EXTRACTION_API_KEY` is preferred; the existing local `ANTHROPIC_API_KEY` is a fallback credential only. There is no scripted-answer fallback. Model failures are recorded as failures and can be retried. Model execution runs after the authenticated create response; stale interrupted executions can be retried after five minutes. Revision compare-and-swap prevents duplicate workers or concurrent reviewers from overwriting evidence.

Original model answers, source snapshots, citations and hashes remain separate from append-only human reviews. Exact-quotation matching normalizes whitespace, not meaning. Correct requires matched quotations, but this does not establish that the interpretation is correct. Human verdicts assess the whole original extraction including conditions and proposed implementation. Proposed test cases are not executed tests.

Reviewed accuracy is original answers marked Correct divided by all reviewed original answers. Corrected, Unsupported, Unverifiable and Duplicate remain separate counts and do not count as correct. Unreviewed answers are excluded. The latest verdict counts; earlier verdicts remain in exported history. Reviewers can add omissions quoting supplied source pages. No recall or full-contract completeness score is inferred from an absence of reported omissions.

Review the source pages for omitted obligations in addition to checking extracted answers. Page review covers only the supplied pages. A verdict evaluates AI accuracy; it never authorizes client configuration changes. Evidence export includes original output, source text, model usage, hashes, review identities and timestamps.

## Guided implementation

The default `/rebate-protection` view now starts with a selected extraction and its original PDF image. Review the interpretation in place, then define a sandbox mapping and create the linked flow. The UI also links here from each extraction's assessment section. Original AI answers and accuracy scores remain unchanged by implementation.

The first mapping adapter accepts copay cents, a per-30-day quantity limit, PA required, and step therapy required. Mapping values and rationale are explicitly reviewer-defined test assumptions; the historical document is not treated as a current client plan. Other contract clauses remain available for review but do not acquire an automatic executable mapping. Remaining book inputs retain their synthetic labels.

A completed model extraction, matching quotations, and a latest Correct or Corrected verdict are required. Sponsor scoping and extraction revision checks protect creation. The isolated process run freezes source pages, original answer, review, mapping, identity and timestamps; the integrity hash covers both baseline and linkage. Creation retries cannot change the mapping under the same key.

Use the selected module's Build & check configuration / Process & check this step action, inspect Expected versus Produced, approve the sandbox release, and follow the downstream links. Verification tests open their recorded results directly. Advanced run controls and the technical map are secondary. Tests and approval are separate, and no operational table is changed.

Images are unmodified 2× renders of PDF pages 43, 59, 60, 115, 139, 140 and 141. Reproduce them using `scripts/render-contract-pages.py` with PyMuPDF. The renderer verifies the PDF fingerprint against the extraction source snapshot before rendering. Click an image to enlarge it or open its original PDF page. An unsupported source fingerprint does not display these images as evidence for another document.

Referenced passages now carry amber line boxes on original page images in extraction review, guided setup, and linked process Expected views. Enlarge page keeps the overlays and supports keyboard dismissal. The unaltered PDF remains available separately. Coordinates are regenerated with the page renderer and bound to the PDF SHA-256. Only unambiguous exact wording (NFC/whitespace normalized) with an already matched citation is highlighted; unmatched or ambiguous passages remain explicitly unlocated. Highlighting locates source text; it does not approve the interpretation.
