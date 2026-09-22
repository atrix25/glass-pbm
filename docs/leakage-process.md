# Connected leakage processing demo

The default `/rebate-protection` view runs an isolated two-claim book through eight dependent processing areas. Process IDs begin `prc_` and use format 2 in the existing AssuranceRun table. Legacy `oas_`, `cck_`, and rebate scenario routes remain separate.

Contract, drug, rate, claims, manufacturer, guarantee, client, and notice outputs are stored with input versions and execution attempts. Claims call the production adjudication function using persisted upstream configuration. Other processors and external evidence are synthetic. The reversal offsets its original financial entries and accumulator movements.

Public provenance: Wisconsin ETG0013 Amendment 7, page 3, supports the qualifying-brand-claim definition. This narrow quotation does **not** authenticate the demonstration's rates, benefits, drug attributes or invoices. Tennessee has no executed contract text in this processing book. All those terms are synthetic assumptions. Full agreement/amendment ingestion is outside this fixed-book demo.

Use Create flow, Run flow or Run next step. Inspect the area requiring simulated approval. Manufacturer acceptance must precede simulated settlement; notice delivery is separate from approval. Continue Run flow after evidence is supplied. Run tests executes independent benchmark and adversarial cases in separate copies; it never approves the selected book. Selected-run completion is also checked.

POST `/api/operational-assurance/process`: create (scenario and UUID key), flow/next/test (id, revision, key), review (step, decision), external (step, kind), repair (step). GET with id exports the complete evidence. Authentication, demo gate, same-origin writes, sponsor/tenant scope, baseline integrity, atomic revision checks and stored command hashes protect mutations. Exact retries do not repeat ledger effects. No operational tables are written.

Test books: clean, implementation errors, missing terms, conflicting terms. Safe repair removes a seeded incorrect implementation override and recalculates from effective terms and upstream data. It retains prior attempts and invalidates dependent outputs, approvals and external evidence. Unknown contract interpretation cannot be auto-repaired.

Limits: this is a fixed synthetic population and a defined suite, not a universal contract compiler or a production payment gate. Independent benchmark calculations are in a separate module but execute in the same application; this is not an external audit. No assertion of universal zero leakage or actual Caremark savings is supported. No real submissions, notices or payments occur.
