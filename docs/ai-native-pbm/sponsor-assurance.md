# Sponsor assurance

`/sponsor/assurance` runs read-only checks against the configured sponsor's records. The sponsor overview links to it from navigation and Plan review.

Checks distinguish internal consistency from independently confirmed funds. Clear requires an observed population and zero exceptions. Review identifies discrepancies, including legacy rebate-retention terms. Not verified identifies missing evidence; the interface never turns a scheduled payment or rebate estimate into a confirmed receipt.

The claim population includes paid and rejected B1/B3 transactions in the current plan year, scoped to sponsor and contract, through the selected clock. Accepted reversals known at that cutoff remove their original claims. Pricing tests compare billed and allowed amounts per claim; absolute discrepancies cannot offset and must not be summed across overlapping tests. Invoice arithmetic follows the existing invoice builder: drug cost plus administration fee minus rebate credit. It does not establish fee authorization.

External rebate receipts and sponsor remittances, affiliate/GPO remuneration and bank-confirmed pharmacy payments remain unverified until complete independent evidence is connected. Rate references, exclusion reasons and captured AWP are presence checks, not validation of signed terms or licensed market prices. Simulated benchmark counts remain visible.

The page recalculates on load and on Run checks. It does not run a background monitor or claim continuous streaming. Execution timestamp, data cutoff and latest claim timestamp are separate. Exports are aggregate JSON snapshots with methods, limitations and sources; they contain no member identifiers. Snapshots are not retained server-side or signed audit records.

Validation: assurance unit tests cover missing populations, missing exception counts, single exceptions, invoice arithmetic and opposite discrepancies. Existing sponsor and rebate tests remain applicable. Local production browser checks cover filters, evidence expansion, export, refresh and responsive layout.
