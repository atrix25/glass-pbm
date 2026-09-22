# Glass: AI-native CVS Caremark small-group offering

This directory defines the target architecture for **Glass within CVS Caremark**, focused on selling a highly automated, more transparent offering to **small group employers**. It supports **Caremark TrueCost or Caremark drug-level rebate models**, with **100% rebate pass-through**. Employer isolation supports this Caremark offering; full-service process coverage does not imply building a separate PBM or replacing every Caremark system. It is a target and migration guide, not a claim that the current repository is production-ready for these workloads.

The design starts with the commercial promise: a plan sponsor can configure and operate a pharmacy benefit, receive an auditable invoice, and reconcile every material dollar to effective-dated contract terms, claim events, pharmacy settlement, and rebate receipts. AI reduces document and operations work around that system of record; it does not become the system of record.

The [initiative context](./initiative-context.md) is the product direction of record, including pricing, rebate policy, Caremark integration, and source-backed regulatory distinctions.

## Blueprint artifacts

- [Target architecture](./architecture.md) — boundaries, flows, isolation, interfaces, and staged implementation.
- [Canonical data model](./data-model.md) — grains, temporal rules, invariants, and migration mapping.
- [Logical DBML](./canonical-model.dbml) — machine-readable target entities and relationships.
- [Agent operating model](./agent-operating-model.md) — authority, policy, approvals, evaluation, and runtime controls.
- [PBM process catalog](./agent-catalog.json) — 65 governed work units across 13 full-service domains.
- [Catalog JSON Schema](./agent-catalog.schema.json) — the strict machine-readable catalog contract.

## Non-negotiable authority model

| Concern | Authority | Role of models |
|---|---|---|
| Claim acceptance, coverage, pricing, cost share, accumulators, reversals | Versioned deterministic rules and ledgers | Extract proposed configuration, explain trace, detect exceptions |
| Contract guarantees, sponsor billing, pharmacy settlement, rebate allocation | Effective-dated deterministic terms and double-entry financial subledgers | Match documents, investigate variance, draft correspondence |
| PA and clinical edits | Approved structured criteria and deterministic evaluation where facts are sufficient | Extract facts, summarize evidence, orchestrate requests, draft rationale |
| Benefit, formulary, network, MAC, and contract changes | Authorized human approval through controlled release workflow | Draft changes and impact analyses |
| Care denial, payment movement, legal attestation, fraud disposition | Authorized human or externally authorized deterministic transaction path | Recommend or prepare; never hold final authority |

Every model output is **untrusted proposed data** until validated. Prompts, retrieval results, confidence scores, and prose are evidence about an agent run, not authoritative business records. No model may directly mutate a claim ledger, accumulator, configuration release, clinical determination, invoice, remittance, or payment instruction.

## Commercial product boundary

The first target is small group employer-sponsored commercial pharmacy benefits within CVS Caremark. Funding arrangements, group-size eligibility, distribution channels, and launch states remain to be defined; do not assume every small group is self-funded. Government-program features, medical benefit administration, prescribing, and custody of client funds are not implied by this architecture; each requires separate product, contractual, compliance, and regulatory analysis before enablement.

A sellable service comprises:

1. **Implement** — ingest signed contract and benefit artifacts, normalize them into proposed configuration, validate, simulate, approve, and publish a version.
2. **Administer** — maintain eligibility, formulary, networks, prices, accumulators, PA criteria, and service queues.
3. **Transact** — accept pharmacy transactions, adjudicate deterministically, return responses, and preserve a replayable trace.
4. **Settle** — reconcile reversals and adjustments, calculate sponsor and pharmacy obligations, issue controlled payment instructions, and close financial periods.
5. **Account** — accrue and collect manufacturer remuneration, allocate receipts according to contract, measure guarantees, and support audits.
6. **Serve** — support members, pharmacies, prescribers, and sponsors with answers grounded in authoritative records.
7. **Improve** — detect operational, financial, clinical, and integrity exceptions; route proposals to accountable people; measure outcomes.

## Bounded contexts

| Context | Owns | Does not own |
|---|---|---|
| Tenant & identity | Tenant hierarchy, users, roles, service principals, consent, authorization policy | Benefit eligibility or business outcomes |
| Commercial contract | Signed artifacts, structured economic terms, guarantees, fee definitions, amendments | Claim execution or cash posting |
| Benefit configuration | Plans, formularies, networks, cost share, limits, effective-dated releases | Runtime claim history |
| Member & eligibility | Member identity within a tenant, coverage spans, enrollment exceptions | Claim pricing |
| Product, network & price reference | Drug identifiers, pharmacies, prescribers, benchmark and MAC versions, network participation | Contract-specific adjudication outcome |
| Claims & accumulators | Transaction lifecycle, deterministic adjudication, DUR edits, accumulator ledger, trace | Sponsor invoicing or bank movement |
| Clinical & PA | Intake, evidence, approved criteria, determinations, appeals, turnaround clocks | Formulary publication or claim payment |
| Pharmacy operations | Credentialing/integration state, MAC appeals, help desk cases, reimbursement exceptions | Sponsor receivables |
| Manufacturer value | Contract terms, utilization accruals, invoices, disputes, cash receipts, allocation | Sponsor invoice issuance |
| Finance & settlement | Financial event journal, sponsor A/R, pharmacy A/P, fees, remittance, reconciliation, payment instructions | Re-adjudicating claims |
| Service operations | Omnichannel cases, knowledge answers, communications, grievances, SLA timers | Changing authoritative records implicitly |
| Integrity & analytics | Signals, investigations, measures, governed read models | Automatic adverse disposition |
| Agent control plane | Agent definitions, policies, runs, tools, proposals, evaluations, approvals | Domain truth or direct consequential writes |
| Audit & compliance | Immutable access/change evidence, retention/legal hold policy, control evidence | Operational editing of source records |

Contexts exchange versioned commands and events through explicit contracts. They do not share writable tables. A context may maintain idempotent projections of another context's events; the source context remains authoritative.

## Target operating principles

- **One commercial fact, one owner.** Claims are not invoices; accruals are not cash; model suggestions are not configuration.
- **Effective time and knowledge time are separate.** Preserve what was true for service date and what the platform knew when it acted.
- **Money is integer minor units.** Currency is explicit, rounding points are named, and posted entries balance.
- **Released configuration is immutable.** Corrections create a new version; claims retain the exact version and reference values used.
- **Every external message is idempotent.** Retried files, transactions, events, and callbacks cannot duplicate business effect.
- **Consequential changes use maker-checker controls.** The proposer cannot be the sole approver; segregation rules are tenant-configurable but cannot weaken platform safety invariants.
- **AI has least privilege and bounded context.** Tool access is scoped to tenant, subject, purpose, fields, and time; retrieved text cannot grant more authority.
- **Observability is tenant-safe.** Logs, traces, metrics, and support tooling minimize PHI and prevent cross-tenant identifiers or payloads from leaking.
- **Availability does not waive correctness.** Defined degraded modes fail closed for unknown eligibility, rules, prices, or accumulator state; business-approved exceptions are explicit and auditable.

## Current Glass: reusable strengths and material gaps

This mapping is based on the current repository and should be revalidated as implementation changes.

| Current strength | Reuse in target | Gap before full-service multi-tenancy |
|---|---|---|
| Deterministic adjudication, pricing, quantity limits, replay, and traces in `src/lib/engine` | Extract behind a versioned claims-domain port; preserve golden and determinism tests | Production transaction semantics, certification, high availability, duplicate/reversal edge coverage, tenant-aware state |
| Integer-cent monetary fields and source-linked effective-dated rules | Retain as domain value objects and provenance requirements | Explicit currency, balanced subledgers, period close, receivables/payables, payment controls |
| Contract rates, rebates, MAC, remittance, sponsor invoice, eligibility, PA, and DUR models | Seed context aggregates and migration adapters | Lifecycle completeness, authorization boundaries, operational workflows, reconciliation and exception handling |
| `ConfigVersion`, claim snapshots, `TraceStep`, and readjudication | Form release and simulation spine | Typed schemas, approvals, rollout/rollback controls, tenant-scoped release registry |
| `AgentPolicy`, `AgentRun`, `AgentProposal`, consequential flag, and evaluations | Seed the agent control plane and evaluation model | Enforced domain write gateway, model/vendor isolation, prompt/tool versioning, redaction, kill switches, independent approvals |
| Postgres app/worker foundation and job claiming | Initial deployment cell and asynchronous workflow substrate | Durable event contracts, outbox/inbox, workflow timers, capacity isolation, disaster recovery evidence |
| Harness, golden, determinism, and invariant tests | Release evidence for deterministic cores | Tenant-isolation tests, contract certification, financial balancing, performance/error budgets, recovery exercises |
| Single `TenantConfig` and role-based users | Migration anchor for a default tenant | Tenant hierarchy on every tenant-owned record, row/database isolation policy, enterprise identity, purpose-aware authorization |
| Member chat with tool/citation records | Grounded service-assistant starting point | Consent, identity proofing, channel integrations, approved content, PHI-safe telemetry, escalation and quality review |

## Evolution without a rewrite

1. **Harden the modular core.** Define typed ports around the existing engine and ledgers; add transaction envelopes, idempotency keys, configuration hashes, balanced journal tests, and an append-only audit contract. Keep the existing UI and database serving the default tenant.
2. **Introduce tenancy as an enforced invariant.** Create tenant hierarchy and identity policy, add tenant keys through additive migrations, backfill the default tenant, use tenant-scoped repositories and database row-level policies, then reject unscoped access in tests and runtime.
3. **Split by operational pressure, not fashion.** Establish an outbox/inbox and versioned events inside the existing deployment. Extract transaction ingress, long-running clinical workflows, document processing, and finance settlement only when scaling, availability, or control boundaries require it.
4. **Complete the commercial loop.** Build implementation workflow, eligibility operations, sponsor A/R, pharmacy A/P, rebate cash allocation, period close, guarantee measurement, and reconciliation before representing the product as full-service.
5. **Add bounded agents.** Begin with extraction and drafting in shadow mode. Advance orchestration only after offline evaluation, tenant-specific acceptance thresholds, human override measurement, and production kill switches. Consequential decisions remain human-authorized.
6. **Scale into cells.** Route each tenant to a home deployment cell with isolated transactional storage, encryption scope, queues, and workers. Keep global services free of PHI and able to route by opaque tenant identifier.

Each stage is deployable behind existing interfaces. Dual-read or dual-write migrations require reconciliation and a finite removal plan; the authoritative source is declared for every phase.

## Architecture acceptance gates

Before a tenant can process live business:

- all domain requests require authenticated tenant context and deny mismatches;
- claim replay is byte-for-byte or semantically identical under the pinned engine/configuration/reference versions;
- transaction duplicate, timeout, reversal, rebill, and unavailable-dependency behavior is specified and tested;
- every posted financial transaction balances and reconciles to source events;
- released business rules cite approved source artifacts and approval records;
- consequential actions cannot bypass the human approval gateway;
- backup restoration, key rotation, cell evacuation, and incident access have been exercised in the target environment;
- interface conformance, performance objectives, recovery objectives, retention, and regulatory obligations have explicit tenant contracts and verified evidence;
- model-enabled workflows pass task-specific quality, leakage, refusal, and adversarial tests, with a tested model-off operating mode.

Numeric service levels, retention periods, and regulatory applicability belong in approved product and tenant control baselines. This document intentionally does not invent them.
