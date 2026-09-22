# AI-native PBM canonical data model

## Purpose and scope

This document defines the target logical data model for the CVS Caremark small-group offering, covering full-service PBM capabilities that can safely be operated by people, deterministic engines, and agents. The accompanying [`canonical-model.dbml`](./canonical-model.dbml) is formal enough to establish grains, keys, and relationships, but it is not a Prisma schema or a deployable migration.

The model covers:

- tenant, party, agreement, and effective-dated commercial terms;
- versioned benefit configuration;
- members, PHI-isolated identity, enrollment, and eligibility;
- immutable claim transactions, adjudication traces, and accumulators;
- formulary, utilization management, clinical evidence, and DUR;
- pharmacy networks, reimbursement schedules, benchmark pricing, MAC, and appeals;
- manufacturer agreements, rebate terms, accruals, invoicing, settlement, and double-entry accounting;
- service cases, queues, durable work, compliance, audit, provenance, lineage, and analytics;
- an agent control plane with identity, policy, runs, tools, evidence, proposals, approval gates, execution, and evaluation.

The design center is the CVS Caremark small-group offering described in [initiative context](./initiative-context.md): TrueCost or Caremark drug-level rebate pricing, 100% rebate pass-through, transparent service fees, and auditable manufacturer remuneration. Public-sector and traditional retained-rebate products are outside the initial target. Funding type is explicit rather than assumed self-funded. The model can be extended to regulated lines without forcing commercial data into Medicare- or Medicaid-specific shapes.

## Small-group product and economic terms

Client agreements record the Caremark pricing model separately from rebate pass-through, funding arrangement, employer eligibility, distribution channel, and member point-of-sale election. `agreement_term` holds versioned, source-backed benefit-package, service-fee, drug-level rebate schedule, payment timing, recipient, and regulatory-applicability terms. Rebate values must carry drug identifier, units, eligibility, effective dates, and provenance; acquisition cost, reimbursement, fees, and rebate value remain distinct.

For this offering, `rebate_term.pass_through_rate = 1`, `rebate_accrual_event.retained_amount = 0`, and `client_amount = gross_amount`. Client entitlement includes any member allocation on behalf of that plan; it is not an additional payment. Accruals are estimates, not proof of cash remittance. Reconcile actual receipts, including attributable affiliate/GPO amounts, to plan entitlements, member credits, sponsor/issuer payments, and remaining payables without double counting. True-ups and reversals preserve this identity. Separately disclosed service fees never reduce the rebate entitlement. These are target invariants requiring production enforcement, not existing runtime guarantees.

## Modeling conventions

### Tenant boundary

Every tenant-owned table has `tenant_id`; its primary or candidate key starts with `tenant_id`, and tenant-owned foreign keys carry the same tenant. An identifier such as `claim_id` is not globally addressable without its tenant.

`drug_product` is the deliberate exception: NDC reference data is a shared, non-PHI catalog. Tenant-specific formulary, price, and utilization records point to it. In a physical implementation:

- enforce composite foreign keys for all tenant-owned relationships;
- apply row-level security using an immutable request-scoped tenant;
- deny cross-tenant joins in service roles;
- use tenant-scoped encryption keys and object-store prefixes;
- include `tenant_id` in partitions, cache keys, events, logs, idempotency records, and analytics.

No tenant boundary may depend only on application filtering.

### Bitemporal state

Mutable business state uses two timelines:

- **valid time** — `valid_from` inclusive and `valid_to` exclusive describe when a value is true in the business domain;
- **system time** — `recorded_at` and `superseded_at` describe when the platform knew that version.

The canonical as-of predicate is:

```sql
valid_from <= :business_at
AND (valid_to IS NULL OR :business_at < valid_to)
AND recorded_at <= :known_at
AND (superseded_at IS NULL OR :known_at < superseded_at)
```

Corrections insert a new version and close the old system interval; they do not overwrite history. Physical PostgreSQL tables should use exclusion constraints to prevent overlapping valid intervals for the same natural key at a single system-time view.

Events and transactions do not need `valid_to`: their domain time is explicit (`service_at`, `incurred_at`, `occurred_at`) and their system time is `recorded_at`.

### Append-only facts

Claims, eligibility events, accumulator events, rebate accrual events, journal entries, journal lines, payment events, compliance events, agent runs, tool invocations, action executions, source artifacts, ingestion runs, lineage edges, and audit events are append-only.

A correction is represented by one of:

1. a domain reversal linked by `reverses_*`;
2. a new event linked by `supersedes_*`;
3. a compensating journal or action;
4. a bitemporal replacement for versioned state.

Hard deletion and in-place correction of accepted facts are prohibited. Retention expiry may cryptographically erase PHI payloads while preserving non-identifying evidence, hashes, and accounting facts.

### Numeric values and money

- Posted money is an integer count of ISO-4217 minor units (`bigint`) plus explicit `currency`.
- Provisional calculations may use fixed-scale decimals, but MUST round at a named rule boundary before posting.
- Unit prices are `decimal(19,9)`.
- Rates are `decimal(18,9)`; basis points are an interface representation, not the canonical storage.
- Quantities are `decimal(24,9)`.
- Counts are integer types.
- Floating-point types are not used for money, rates, quantities, clinical dose calculations, or financial analytics.

Each rule defines its rounding mode, scale, and rounding point. Claim outputs retain the exact benchmark version and unit price used. Currency conversion, if introduced, requires explicit rate, source, effective time, and gain/loss postings.

### Idempotency and ordering

Every externally submitted fact, durable work item, tool write, agent run, and financial posting has a tenant-scoped idempotency key. A duplicate key with an identical canonical request hash returns the original result. The same key with a different hash is an error.

Source feeds additionally use control numbers, source record keys, and content hashes. Domain ordering is not inferred from UUIDs: use source sequence, `ordinal`, business time, and then `recorded_at`. Worker leases coordinate execution but do not define business truth.

### Version pinning and reproducibility

Every adjudication and consequential automated decision pins:

- `configuration_release_id`;
- deterministic `engine_version` and `ruleset_version`;
- source and price-list versions;
- canonical input and output hashes;
- ordered trace steps and cited artifacts.

Agent runs separately pin the agent definition, policy in force, model name/version, prompt hash, tool manifest hash, and context manifest hash. A later policy or prompt change cannot rewrite the standard by which an earlier run is judged.

## Domain model

### Tenant, party, agreement, and configuration

`party` is the common legal/entity identity for sponsors, the PBM, pharmacies, manufacturers, prescribers, carriers, vendors, regulators, and contracting entities. `party_identifier` carries typed external identifiers without putting identifier-specific columns on every business table.

`agreement` connects buyer and seller parties and supports amendments through `parent_agreement_id`. `agreement_term` is a typed, scoped, source-cited term bag for provisions that do not merit a dedicated operational table. Frequently executed terms use typed structures:

- `reimbursement_schedule` for pharmacy and client pricing;
- `rebate_term` for manufacturer remuneration;
- `benefit_rule` for member liability and coverage;
- `compliance_obligation` for statutory and contractual clocks.

`configuration_release` is a content-addressed, approved configuration bundle. Benefits, formularies, networks, claims, and UM cases pin a release. Configuration is promoted by creating a release, validating it, approving it, and assigning an effective interval—never by editing production rows in place.

### Member, identity, and eligibility

`person` provides a pseudonymous clinical and operational join key. Direct identifiers are encrypted in `phi.member_identity`, a separately permissioned schema/storage boundary. The operational `member` record holds only tokens and benefit relationship data.

Eligibility arrives as immutable `eligibility_file` and `eligibility_event` facts. `eligibility_span` is a bitemporal projection derived from accepted events. This preserves all three dates that commonly diverge:

- when coverage is effective;
- when the sponsor reported the change;
- when the PBM recorded and processed it.

Retroactive eligibility does not silently alter the historical knowledge available to a claim. Replay can ask both “was the member eligible by current truth?” and “what eligibility did adjudication know then?”

### Claims and accumulators

`claim` is one immutable NCPDP-style transaction. A reversal or rebill is a new claim linked to the original; it never updates the paid transaction. Rejected claims remain facts. The row pins the eligibility, plan, agreement, configuration, and engine context used.

Amounts are normalized into `claim_amount`, separating submitted, benchmark, allowed, pharmacy-paid, client-billed, plan-paid, and member-liability components. This supports pass-through verification without adding a column for every new amount qualifier.

`adjudication_trace` records ordered rule evaluation with stable rule identifiers, versions, inputs, outputs, citations, and whether the rule fired. It is the reproducible derivation, not an explanatory summary generated later.

`accumulator_account` defines the member/plan/period/type bucket and limit. `accumulator_event` is a signed, immutable contribution from a claim, medical transfer, reversal, or adjustment. Current balances are projections (`sum(amount)`), never independently mutable source fields.

### Clinical and utilization management

`clinical_criteria_set` contains an executable, source-cited criteria snapshot with an engine version. `utilization_management_case` handles PA, step therapy, quantity exceptions, and formulary exceptions. `clinical_evidence` keeps encrypted unstructured material and normalized facts together so a reviewer can verify extraction.

`clinical_decision` is append-only and identifies its human or agent decision-maker, criteria hash, rationale, effective interval, and superseded decision. A denial, care restriction, or clinically consequential approval requires the configured clinical approval gate; an agent proposal alone is not a decision.

`dur_signal` records prospective or retrospective drug-utilization findings with evidence, rule, engine version, and observation time. Signal generation and case resolution remain separate facts.

### Formulary, network, and pricing

The shared `drug_product` catalog normalizes NDC reference attributes. Tenant-owned `formulary` and `formulary_coverage` assign coverage, tier, PA, step, quantity, and channel restrictions with source citations and bitemporal validity.

`network_participation` joins pharmacy, network, pharmacy agreement, and reimbursement schedule. This makes “in network” distinct from “paid under which terms.” A pharmacy can participate in several networks under different schedules and intervals.

`price_list` and `product_price` version NADAC, AWP, WAC, MAC, and other benchmarks. Content hashes and source artifacts make lists reproducible. A claim stores the exact price references and amounts used. `mac_appeal` models submission, statutory decision/adjustment clocks, cited available product, outcome, and adjustment.

### Rebates

`rebate_agreement` identifies the manufacturer, contracting entity (PBM/GPO/aggregator), and optional client agreement. `rebate_term` represents each remuneration type independently—base rebate, price protection, administrative fee, data fee, formulary placement, and other value cannot be collapsed into one opaque “rebate” number.

`rebate_accrual_event` is the immutable claim-level estimate and true-up trail. Gross, client, and retained values must reconcile for each event. Manufacturer invoices and collections use the common invoice, payment, and ledger structures, preserving the lag between accrual, billing, receipt, and sponsor credit.

### Finance and settlement

`invoice` and `invoice_line` cover sponsor billing, pharmacy remittance, and manufacturer rebate billing. Lines retain source entity references and lineage edge sets.

`ledger_account`, `journal_entry`, and `journal_line` form the accounting source of truth. Each posted journal balances debits and credits by tenant and currency. Claims, fees, rebate receivables, sponsor credits, pharmacy payables, cash, reversals, and write-offs are separate postings. Operational statuses cannot manufacture a financial balance.

`payment_event` records authorization, settlement, return, and reversal. Cash status is derived from payment facts and ledger postings, not from comparing a due date with the wall clock.

### Service, work, and compliance

`service_case` is the durable container for member inquiries, pharmacy disputes, appeals, eligibility exceptions, audit findings, and incidents. `work_item` provides queue, assignment, due time, retries, idempotency, and lease semantics. Cases describe the customer/regulatory problem; work items describe executable tasks.

`compliance_obligation` versions statutory, regulatory, and contractual rules with source citations, triggers, deadline logic, and required evidence. `compliance_event` records triggering, notice, decision, adjustment, disclosure, and completion evidence. Timeliness is computed from these events; a mutable “SLA met” flag is insufficient.

`audit_event` is the tamper-evident record of consequential access and writes by humans, services, and agents. Hash chaining or immutable/WORM export is a physical implementation concern, but append-only semantics are part of the logical contract.

### Provenance, lineage, and analytics

`source_artifact` is the content-addressed registry for contracts, amendments, formularies, criteria, price files, eligibility files, statutes, evidence, reports, and model assets. `ingestion_run` records the exact pipeline version and result.

`lineage_edge` relates source records to normalized rows, claim outputs, invoices, journal entries, analytics, and agent evidence. Transformations are named and versioned. Every rule-bearing or externally reported value must be traceable to source artifacts and transformations.

`analytics_metric_definition` versions semantic definitions and grain. `analytics_fact_daily` is a rebuildable projection with source watermark and build run. Analytics never becomes the source for claim payment, accumulator balance, clinical decision, or accounting. PHI-safe marts should use pseudonymous dimensions, minimum-cell suppression, and purpose-specific access.

## Agent control plane

The control plane separates reasoning from authority:

1. `principal` identifies humans, services, and agents; `role_assignment` grants scoped, effective-dated authority.
2. `agent_definition` pins purpose, model, prompt hash, tool manifest, schemas, and data-classification ceiling.
3. `agent_policy` states the autonomy level, allowed/denied actions, PHI rules, consequential-action rules, and spend limit in force.
4. `agent_run` is one idempotent goal execution under exactly one definition and policy.
5. `agent_step`, `tool_invocation`, and `agent_evidence` preserve ordered execution, I/O hashes, external request IDs, and the evidence actually seen.
6. `agent_proposal` describes a desired domain action but has no direct write authority.
7. `approval_gate` records required policy, human, dual-control, clinical, or finance approval.
8. `action_execution` is the sole bridge from an approved proposal to a domain write and records before/after hashes plus compensation.
9. `agent_evaluation_case` and `agent_evaluation_result` version regression, refusal, trajectory, citation, and outcome evaluations.

Tools expose narrow domain commands, not unrestricted SQL. Reads are tenant-, purpose-, and classification-scoped. Writes require idempotency and produce both a domain fact and an audit event. PHI shown to an agent is minimized and represented in `agent_evidence` by reference/hash, not copied into general-purpose traces.

## Required invariants

These rules belong in database constraints where possible, with transaction services and continuous reconciliation for cross-row rules:

1. **Tenant closure:** every tenant-owned foreign key has the same `tenant_id`; no cross-tenant reference or aggregate is valid.
2. **Temporal non-overlap:** active bitemporal versions for the same natural key cannot overlap in valid time at the same system-time view.
3. **Half-open intervals:** all validity periods use `[valid_from, valid_to)` and require `valid_to > valid_from`.
4. **Immutable facts:** accepted facts cannot be updated or deleted; reversals and supersessions must point to an earlier fact in the same tenant.
5. **Idempotency:** `(tenant_id, idempotency_key)` resolves to one canonical request hash and one result.
6. **Claim chain:** a reversal/rebill references an earlier compatible claim; net operational and financial impacts are explicit, not overwritten.
7. **Pinned execution:** accepted claims and clinical decisions have immutable configuration, engine/ruleset, source, input, and output identity.
8. **Amount conservation:** claim component equations are defined per transaction type; pass-through agreements require client ingredient/fee reimbursement to match pharmacy reimbursement except explicitly cited fees.
9. **Accumulator conservation:** a balance equals signed accepted events as of business/system time; reversal events exactly negate the applicable original contribution.
10. **Rebate conservation:** `gross_amount = client_amount + retained_amount`; for the Glass offering, `retained_amount = 0` and `client_amount = gross_amount`. No contract term or agent override may weaken 100% pass-through.
11. **Double entry:** for each posted journal and currency, total debits equal total credits; lines are positive and side carries direction.
12. **Subledger reconciliation:** claim, rebate, invoice, payment, and settlement subledgers reconcile to control accounts without orphan postings.
13. **No float money:** posted money uses integer minor units; rates, quantities, and unit prices use fixed-scale decimals and named rounding rules.
14. **PHI isolation:** direct identifiers exist only in approved encrypted stores; operational, analytics, trace, logging, and agent tables use tokens or references.
15. **Provenance:** rule-bearing configuration, externally sourced facts, decisions, invoices, and reported metrics link to content-addressed source and transformation versions.
16. **Agent least privilege:** an agent can invoke only tools allowed by its pinned policy, role scope, purpose, and classification ceiling.
17. **Consequential gates:** denial of care, movement of money, benefit/configuration changes, eligibility termination, and external communications require the configured approval; policy cannot silently bypass a mandatory gate.
18. **Proposal/execution separation:** an agent proposal changes no domain state; an action execution requires satisfied gates and creates auditable domain facts.
19. **Agent replay evidence:** each material output has model/prompt/tool/context identity and cited evidence hashes; secrets and unnecessary PHI are excluded.
20. **Analytics derivability:** analytics projections identify metric version, source watermark, and build run and can be rebuilt from canonical facts.

## Migration mapping from `prisma/schema.prisma`

The migration should be incremental and dual-run. Existing IDs can be preserved as namespaced external keys while canonical UUIDs are assigned. No current table should be renamed or repurposed in place during initial adoption.

### Direct and consolidating mappings

| Current Prisma model(s) | Canonical target | Migration treatment |
|---|---|---|
| `TenantConfig` | `tenant`, deployment/config defaults | Create a real tenant; move sponsor/contract defaults to tenant-scoped configuration, not one singleton row. |
| `PlanSponsor`, `Pharmacy`, `Prescriber` | `party`, `party_identifier`, plus `pharmacy` | Backfill party rows and typed identifiers; preserve existing IDs as `external_key`. |
| `Contract`, `ContractRate` | `agreement`, `agreement_term`, `reimbursement_schedule` | Split legal relationship from executable pharmacy/client rates; convert cents/BPS to decimals. |
| `BenefitPlan`, `CostShareRule`, `ConfigVersion` | `benefit_plan`, `benefit_rule`, `configuration_release` | Hash canonical payloads, pin engine/ruleset versions, and bitemporally version assignments. |
| `Member` | `person`, `phi.member_identity`, `member` | Tokenize cardholder/member keys; encrypt direct identifiers; move diagnosis data out of demographics into governed clinical evidence/facts. |
| `EligibilityFile`, `EligibilityTransaction`, `EligibilitySpan` | `eligibility_file`, `eligibility_event`, `eligibility_span` | Preserve control numbers and arrival/process times; convert spans into bitemporal projections. |
| `Drug` | `drug_product` | Promote NDC to shared reference data; convert package quantities from float to fixed decimal. |
| `Formulary`, `FormularyEntry` | `formulary`, `formulary_coverage` | Preserve raw source locator while normalizing restrictions and criteria references. |
| `Network`, `NetworkPharmacy` | `network`, `network_participation` | Add pharmacy agreement and reimbursement schedule to each participation interval. |
| `DrugPrice`, `MacList`, `MacPrice`, `MacPriceChange`, `MacAppeal` | `price_list`, `product_price`, `mac_appeal`, lineage/events | Materialize every historical list version; convert float unit prices to decimal from original source precision, not binary float rendering when source files are available. |
| `Claim`, `TraceStep` | `claim`, `claim_amount`, `adjudication_trace` | Keep each transaction immutable, add tenant/idempotency keys, normalize amounts, and pin release/engine/source hashes. |
| `Accumulator`, `AccumulatorTransaction`, `AccumulatorTransfer`, `AccumulatorFile` | `accumulator_account`, `accumulator_event`, `source_artifact`, `ingestion_run` | Treat current balance as a projection; backfill signed events and reconcile before cutover. |
| `PACriteriaTree`, `CriteriaStep` | `clinical_criteria_set` | Serialize a canonical executable definition, source hash, and engine version. |
| `PriorAuthorization`, `PADecisionStep`, `ClinicalNote` | `utilization_management_case`, `clinical_evidence`, `clinical_decision`, trace/evidence | Separate case state, evidence, traversed criteria, and append-only decisions; encrypt note bodies. |
| `DurAlert`, `OpioidProduct` | `dur_signal`, clinical reference/ruleset assets | Keep observed evidence and pin detector/engine/source versions. |
| `RebateContract`, `RebateTerm`, `RebateAccrual`, `RebateInvoice` | `rebate_agreement`, `rebate_term`, `rebate_accrual_event`, `invoice`, ledger | Preserve each remuneration type and introduce accrual/receivable/cash postings. |
| `SponsorInvoice`, `RemittanceRun`, `RemittanceLine` | `invoice`, `invoice_line`, `payment_event`, ledger | Backfill common invoice/settlement shapes and reconcile totals to claims before posting opening entries. |
| `Job`, `JobRun` | `work_item`, execution telemetry | Add tenant, queue, leases, and idempotency; keep technical logs outside the logical business payload. |
| `ServiceIncident`, `MacAppeal`, eligibility rejects | `service_case`, `work_item`, `compliance_event` | Create durable cases and statutory/contractual clocks around existing domain facts. |
| `SourceDocument`, `AuditFinding`, `AuditFindingResult`, `HarnessResult` | `source_artifact`, lineage, compliance/audit evidence, evaluation artifacts | Content-address all inputs and connect outputs by versioned lineage. |
| `BookDay`, `BookDayDimension`, `NpsSnapshot`, `ThroughputRun`, `IntegritySignal` | metric definitions, `analytics_fact_daily`, domain-specific analytical facts | Treat as rebuildable projections with definition version and watermark; preserve detector evidence where it is a domain finding. |
| `User`, `Session`, `ApiKey` | `principal`, `role_assignment`, authentication subsystem | Map identities and scopes; credentials/session secrets remain in a dedicated authentication store, outside this logical model. |
| `AuditEvent` | `audit_event` | Add tenant, actor kind, before/after hashes, request correlation, and immutable retention. |
| `AgentPolicy`, `AgentRun`, `AgentStep`, `AgentProposal` | full agent control plane | Preserve historical rows, then add pinned definition/policy, tools, evidence, gates, executions, and evaluations. |
| `ChatSession`, `ChatMessage`, `EvalCase`, `EvalResult` | agent run/evidence and evaluation tables | Retain chat UX data only as needed; do not treat free-text tool-call JSON as authoritative execution history. |
| `CopyOverride`, `ReadjudicationRun` | configuration release/proposal and evaluation/replay artifacts | Convert approved copy/config changes into releases; pin both baseline and candidate engines/configurations for replay. |

### Recommended migration sequence

1. **Foundation:** create tenant, party, principal, source-artifact, configuration-release, and ID crosswalks; add tenant-scoped access controls.
2. **Reference/configuration:** load drug, agreements, benefits, formularies, networks, prices, and criteria with source hashes and bitemporal intervals.
3. **PHI/member:** tokenize operational identifiers, move direct identifiers into the PHI vault, and backfill member/eligibility history.
4. **Claims/clinical:** dual-write new claim and UM transactions to immutable facts; compare adjudication outputs and traces by canonical hash.
5. **Financial subledgers:** backfill claim amounts, accumulator and rebate events, invoices, and payments; reconcile to existing totals.
6. **General ledger:** establish chart of accounts and post balanced opening/control entries only after subledger reconciliation is exact.
7. **Service/compliance:** generate cases, work, obligations, and deadline events from existing appeals, incidents, and rejected transactions.
8. **Agent control plane:** route tools through proposals, mandatory gates, and executions; prohibit direct agent writes to domain tables.
9. **Analytics:** rebuild projections from canonical facts and compare every current dashboard metric at matching as-of times.
10. **Cutover:** make canonical stores authoritative one bounded context at a time; retain read-only legacy data and crosswalks through audit retention.

At each stage, run tenant closure, row-count, amount-conservation, temporal-overlap, hash, and subledger reconciliation checks. A migration batch is restartable by idempotency key and source hash. Failed batches create new ingestion facts; they do not partially rewrite accepted history.

## Physicalization notes

The logical model intentionally omits partition declarations, row-level-security policies, exclusion-constraint syntax, event-outbox tables, indexes tailored to measured workloads, and object-storage lifecycle rules. A PostgreSQL physical design should add them after access paths and retention volumes are known.

Prisma can remain an application mapping layer, but database-native migrations will be needed for composite tenant foreign keys, temporal exclusion constraints, append-only triggers/permissions, deferrable double-entry checks, partitioning, row-level security, and restricted PHI schemas. The canonical model is the contract those physical implementations must preserve.
