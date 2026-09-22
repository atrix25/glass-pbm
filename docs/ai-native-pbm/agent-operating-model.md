# Agent-native PBM operating model

## Status and intent

This document defines the control plane for agents that perform PBM work. It is a normative operating model, not a description of current behavior. Implementations conform only when the controls below are enforced by the runtime and represented in durable records.

The control plane separates four concerns:

1. **Definition:** immutable instructions, tools, schemas, tests, and ownership.
2. **Deployment:** the approved versions and policy bundle active in an environment and tenant scope.
3. **Task execution:** one bounded unit of work with frozen inputs and authority.
4. **Effect:** a separately authorized, idempotent, receipted change to a system of record or communication channel.

An agent may reason, but it never acquires authority by reasoning. Authority comes from the deployment, policy decision, and—where required—identified humans. No prompt, model output, confidence score, or caller-supplied flag can broaden it.

Normative terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** have their usual requirements meaning.

## Caremark small-group operating context

Apply the [initiative context](./initiative-context.md) to every process deployment. Business-role names identify required accountability; named Caremark owners and delegation must be assigned before activation. Agents prioritize repeatable small-group quoting, onboarding, enrollment, service, reporting, and reconciliation, using approved Caremark systems. No agent may invent TrueCost terms, rebate schedules, product availability, savings guarantees, or legal compliance claims.

Pricing proposals MUST select an approved TrueCost or drug-level rebate configuration. Rebate allocation MUST preserve 100% client entitlement and zero retention, with separate fees and receipt-backed reconciliation. Plan pass-through and member point-of-sale elections MUST remain distinct. Product policies apply from launch; legal obligations are independently versioned by authority, applicability, status, and effective date.

## Safety invariants

These invariants apply in every environment, including demos, replays, backfills, and incident tooling:

- Unknown agent, definition, deployment, tool, action, consequence, subject, policy result, or approval requirement **MUST fail closed**.
- Classification is a positive allowlist. Absence from a consequential-action list never implies safety.
- A model can propose classifications and actions; trusted deterministic code validates and enforces them.
- Every task is pinned to immutable definition, deployment, policy-bundle, model, prompt, tool-contract, and evaluator versions.
- Every side effect is executed through the effect service, never directly by a model-facing tool.
- Every external attempt has an idempotency key and an append-only receipt, including failures and ambiguous outcomes.
- Approval is scoped to an exact decision digest. Material changes to inputs, evidence, payload, policy, or deployment invalidate approval.
- The requester, agent operator, approver, and effect executor are distinct authorities where separation of duties requires it.
- PHI is minimized before model invocation and never placed in prompts, logs, traces, or evidence stores without an explicit data-use scope.
- Runtime policy can reduce authority but cannot exceed the approved deployment ceiling.
- Kill switches are checked at admission and again immediately before each tool call and effect.
- A successful run is not evidence of a successful effect; only a verified external receipt is.
- Audit records are append-only. Corrections supersede prior records rather than rewriting them.
- When required evidence is missing, stale, contradictory, unverifiable, or outside scope, the result is `hold` or `escalate`, never inferred permission.

## Control-plane objects

All identifiers are opaque, globally unique IDs. All timestamps are UTC. All mutable records use optimistic concurrency. Canonical serialization is required anywhere a digest is used.

### Agent definition

An `AgentDefinition` is immutable after publication:

```ts
type AgentDefinition = {
  id: string;
  version: string; // immutable semver plus content digest
  status: "draft" | "validated" | "published" | "retired";
  purpose: string;
  ownerRoleId: string;
  executionMode: ExecutionMode;
  inputSchemaRef: string;
  outputSchemaRef: string;
  promptArtifactRef?: string;
  deterministicArtifactRef?: string;
  toolGrants: ToolGrant[];
  allowedActionTypes: string[];
  consequenceRulesRef: string;
  requiredEvidenceRulesRef: string;
  defaultRiskTier: RiskTier;
  autonomyCeiling: Autonomy;
  evalSuiteRef: string;
  dataUsePolicyRef: string;
  createdBy: string;
  createdAt: string;
  contentDigest: string;
};
```

Publishing creates a new version; it never edits an earlier one. Definitions name role IDs and capability grants, not human-readable owners or tool-name strings alone.

### Deployment

An `AgentDeployment` binds immutable components to a bounded operating scope:

```ts
type AgentDeployment = {
  id: string;
  revision: number;
  definition: { id: string; version: string; digest: string };
  environment: "development" | "staging" | "production";
  tenantScope: string[];
  populationScope: string[];
  trafficAllocationBps: number;
  policyBundle: { version: string; digest: string };
  model?: { provider: string; name: string; version: string };
  toolContractVersions: Record<string, string>;
  autonomyCeiling: Autonomy;
  releaseGateReceiptIds: string[];
  status: "pending" | "active" | "draining" | "suspended" | "retired";
  activatedBy: string;
  activatedAt?: string;
  supersedesDeploymentId?: string;
};
```

Activation requires release gates and a human with release authority. Tasks snapshot the deployment revision; an in-flight task never silently moves to a newer definition or policy bundle. Emergency policy overlays may only narrow authority and are included in every subsequent policy decision.

### Task

A `Task` is the durable orchestration boundary:

```ts
type TaskState =
  | "queued"
  | "admitted"
  | "running"
  | "awaiting_evidence"
  | "awaiting_approval"
  | "scheduled"
  | "executing"
  | "verifying"
  | "succeeded"
  | "held"
  | "escalated"
  | "refused"
  | "compensating"
  | "compensated"
  | "failed"
  | "cancelled";

type Task = {
  id: string;
  taskType: string;
  tenantId: string;
  subjectRefs: SubjectRef[];
  requestedBy: PrincipalRef;
  deploymentRevision: string;
  policySnapshotDigest: string;
  inputRef: string;
  inputDigest: string;
  riskTier: RiskTier;
  consequenceClasses: ConsequenceClass[];
  autonomy: Autonomy;
  reviewWindow?: ReviewWindow;
  fallbackQueueId: string;
  idempotencyKey: string;
  state: TaskState;
  deadlineAt?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
};
```

Admission validates tenant and subject scope, authenticates the requester, deduplicates the idempotency key, computes consequences and risk, resolves policy, checks kill switches, and freezes authority. A task cannot progress by directly editing `state`; transitions are commands validated against a state machine and recorded as events.

Retries reuse the same task and effect idempotency keys unless the input has materially changed. A changed input creates a new task linked by `supersedesTaskId`.

### Scoped tools

A tool grant is a capability, not a name:

```ts
type ToolGrant = {
  toolId: string;
  contractVersion: string;
  operations: string[];
  tenantScope: string[];
  resourceTypes: string[];
  fieldProjection: string[];
  purposeOfUse: string[];
  rowPredicateRef?: string;
  maxRecords: number;
  timeoutMs: number;
  rateLimitRef: string;
  networkDestinationAllowlist: string[];
  sideEffect: "none" | "staged" | "external";
};
```

The tool gateway issues short-lived, task-bound capability tokens. It validates arguments and results against versioned schemas, injects tenant and subject predicates server-side, enforces field projection and record limits, redacts disallowed data, and writes a call record before returning.

Agent-facing tools are read-only or stage an effect request. External writes, messages, payments, eligibility changes, coverage decisions, and contract changes are effect-service operations and cannot be hidden inside a generic tool callback.

Tool errors are typed as `denied`, `invalid_input`, `not_found`, `conflict`, `rate_limited`, `timeout`, `upstream_failed`, or `outcome_unknown`. The model never interprets an unknown outcome as success.

### Evidence

Evidence is a first-class, immutable object:

```ts
type EvidenceItem = {
  id: string;
  taskId: string;
  type: string;
  sourceSystem: string;
  sourceRecordRef: string;
  sourceVersion?: string;
  collectedBy: PrincipalRef;
  collectedAt: string;
  observedAt?: string;
  validFrom?: string;
  validUntil?: string;
  contentRef: string;
  contentDigest: string;
  schemaVersion: string;
  extractionMethod: "direct" | "deterministic" | "model" | "human_attested";
  quality: "verified" | "corroborated" | "unverified" | "contradicted";
  phiClassification: string[];
  purposeOfUse: string;
};
```

Decision claims cite evidence IDs and, where applicable, exact fields or spans. Evidence has freshness rules by decision type. Model summaries are derived evidence and never replace source evidence. Contradictions are retained and routed according to policy. Large content lives in encrypted object storage; the audit store retains a digest and access-controlled reference, not a truncated substitute presented as complete.

### Decision and policy decision

Reasoning output and authority output are separate:

```ts
type Decision = {
  id: string;
  taskId: string;
  actionType: string;
  actionSchemaVersion: string;
  payloadRef: string;
  payloadDigest: string;
  claims: Array<{ statement: string; evidenceIds: string[] }>;
  alternativesConsidered: string[];
  uncertainty: string[];
  modelConfidenceBps?: number; // telemetry only
  consequenceClasses: ConsequenceClass[];
  riskTier: RiskTier;
  createdByStepId: string;
  decisionDigest: string;
};

type PolicyOutcome = "allow" | "require_approval" | "hold" | "deny";

type PolicyDecision = {
  id: string;
  taskId: string;
  decisionDigest: string;
  outcome: PolicyOutcome;
  matchedRuleIds: string[];
  consequenceClasses: ConsequenceClass[];
  riskTier: RiskTier;
  requiredApprovalPolicyId?: string;
  reviewWindow?: ReviewWindow;
  fallbackQueueId: string;
  reasonCodes: string[];
  evaluatedAt: string;
  policyBundleDigest: string;
};
```

The policy engine is deterministic. It validates that the action is registered, independently computes consequence classes from action, payload, subject, destination, amount, and context, and rejects any mismatch with the agent-proposed classes. `modelConfidenceBps` can trigger additional review but can never remove one.

## Typed, fail-closed consequence classes

```ts
const CONSEQUENCE_CLASSES = [
  "care",
  "coverage",
  "money",
  "contract",
  "external_communication",
  "phi_disclosure",
  "credentialing",
  "legal_compliance",
  "security",
] as const;

type ConsequenceClass = (typeof CONSEQUENCE_CLASSES)[number];

type ConsequenceAssessment =
  | {
      status: "classified";
      classes: [ConsequenceClass, ...ConsequenceClass[]];
      ruleIds: [string, ...string[]];
    }
  | {
      status: "none";
      ruleIds: [string, ...string[]]; // explicit proof of no consequence
    }
  | {
      status: "unknown";
      reason: string;
    };
```

An unregistered action, schema mismatch, unrecognized destination, missing contextual field, empty rule result, or classifier failure yields `status: "unknown"`. Unknown consequence is treated as `R4`, cannot execute, and enters the safety fallback queue. Callers cannot send `none`; only the trusted classifier can produce it with a matched rule.

An action may have multiple classes. Controls combine by taking the most restrictive requirement; no class cancels another.

| Class | Includes | Minimum control |
|---|---|---|
| `care` | Clinical recommendation, utilization-management criterion interpretation, therapy interruption, safety outreach | Licensed clinical authority before effect; urgent-care fallback |
| `coverage` | Approval, denial, termination, effective dates, accumulators, formulary or eligibility effect | Pre-effect approval; appeal and notice obligations checked |
| `money` | Claim payment, pricing, rebate, settlement, refund, member liability, recovery | Amount and account limits; finance authority; dual control above threshold |
| `contract` | Benefit design, guarantee, network term, MAC methodology, amendment, renewal | Authorized contract owner and effective-date/change-window validation |
| `external_communication` | Message to member, prescriber, pharmacy, sponsor, regulator, vendor, or public channel | Approved content/destination/channel; send receipt; communication retention |
| `phi_disclosure` | PHI leaving its current authorized boundary or purpose of use | Privacy authority where required; minimum necessary and destination validation |
| `credentialing` | Network admission/removal, sanction, license or credential status | Credentialing authority; source verification; no model-only adverse action |
| `legal_compliance` | Filing, attestation, statutory response, appeal deadline, regulatory interpretation | Compliance/legal authority based on jurisdiction and filing type |
| `security` | Identity, access, secret, key, permission, network rule, incident containment | Security authority; privileged path; immutable security audit |

The minimum controls above are floors. Jurisdiction, contract, tenant, population, dollar amount, deadline, and vulnerability may raise the risk tier or quorum.

## Risk tiers

Risk is assigned to each proposed effect, not merely to an agent. A task with multiple effects takes the highest tier until split into independently reviewable tasks.

| Tier | Meaning | Examples | Execution rule |
|---|---|---|---|
| `R0` | Read-only, no material disclosure | Aggregate lookup within existing scope; deterministic validation | May run automatically; evidence and access logs required |
| `R1` | Low-impact, reversible internal effect | Internal queue annotation; draft generation; non-authoritative classification | May act under approved policy with retrospective review |
| `R2` | Material or externally visible effect with bounded harm | Routine outbound status message; reversible eligibility correction; low-value adjustment | Pre-effect single approval unless a specific regulation-tested policy permits bounded act-with-review |
| `R3` | High-impact, regulated, hard-to-reverse, or multi-party effect | Coverage denial/termination; care restriction; large payment; PHI disclosure to a new recipient; contract change; credentialing action | Pre-effect quorum and separation of duties; no model as final authority |
| `R4` | Prohibited, unknown, emergency-only, or outside deployed scope | Unknown action/classification; unsupported legal filing; secret rotation by a general agent; irreversible bulk action | Refuse or hold for designated human emergency procedure |

Risk calculation is deterministic and versioned. At minimum:

```text
risk = max(
  consequence-class floor,
  action-type floor,
  amount/member-count/bulk threshold,
  reversibility and compensation quality,
  evidence quality and freshness,
  recipient and data sensitivity,
  statutory or contractual deadline,
  population vulnerability,
  anomaly and incident overlays
)
```

Bulk effects are never treated as a collection of harmless single effects. Threshold crossing raises the tier before execution.

## Execution modes and autonomy

Execution mode describes how a result is produced:

```ts
type ExecutionMode =
  | "deterministic"
  | "model"
  | "hybrid"
  | "human_authority";

type Autonomy =
  | "observe"
  | "propose"
  | "act_with_review"
  | "act"
  | "suspended";
```

- **deterministic:** versioned code or rules produce the decision. It is still subject to policy and approval.
- **model:** a model produces a draft or recommendation. Model mode cannot be final authority for R2–R4 effects.
- **hybrid:** a model extracts or proposes; deterministic code validates schemas, recomputes material values, classifies consequence, and applies policy.
- **human_authority:** an authorized person makes the final judgment. Agents may prepare evidence and drafts but cannot impersonate the authority.

Autonomy is an upper bound:

- `observe` permits read-only analysis and telemetry, with no proposal offered as operational work.
- `propose` permits evidence collection and a decision awaiting human action.
- `act_with_review` permits only policy-enumerated R1 actions, or exceptional bounded R2 actions with explicit regulation/contract validation, guaranteed compensation, and an open review obligation.
- `act` permits R0 and policy-enumerated R1 actions. It never overrides consequence-class minimums.
- `suspended` denies new tasks and effects and drains or holds in-flight work according to the kill-switch mode.

Effective autonomy is the minimum of definition ceiling, deployment ceiling, tenant policy, environment policy, incident overlay, task policy, tool grant, and consequence/risk rule. No missing layer defaults upward.

`act_with_review` is not equivalent to `act`. It creates a review obligation with a deadline, named queue, reviewer role, and compensation plan. If those cannot be created atomically before the effect, execution is denied.

## Review windows and fallback queues

```ts
type ReviewWindow = {
  startsAt: "decision_created" | "effect_verified";
  durationSeconds: number;
  reviewerRoleIds: string[];
  queueId: string;
  escalationScheduleId: string;
  onBreach: "hold_future" | "suspend_deployment" | "activate_compensation";
};
```

Default maximum windows are policy floors, not service targets:

| Work | Maximum review window | Breach behavior |
|---|---:|---|
| R1 internal reversible effect | 1 business day | Hold same action type after threshold breach |
| R2 bounded effect allowed with review | 4 hours, or before the external deadline if sooner | Suspend action type and assess compensation |
| Clinical or coverage time-sensitive proposal | Before applicable clinical/SLA deadline | Route immediately to urgent licensed queue |
| PHI or security exception | No retrospective window | Pre-effect review only |
| R3 | No retrospective window | Pre-effect quorum only |

Every admitted task has exactly one primary fallback queue and an escalation schedule. Required queues are:

- `clinical-urgent`: licensed pharmacist/medical authority, continuously monitored where care deadlines require it.
- `coverage-operations`: eligibility, PA, appeal, and benefit administration authority.
- `finance-settlement`: claim money, reconciliation, rebate, recovery, and settlement authority.
- `contract-governance`: sponsor benefit and contract authority.
- `privacy-compliance-legal`: PHI, filing, statutory, and contractual interpretation.
- `credentialing-network`: pharmacy and prescriber network authority.
- `security-incident`: privileged security responders.
- `external-communications`: channel, content, recipient, and disclosure review.
- `agent-safety`: unknown classification, policy errors, anomalous behavior, and kill-switch drains.

A queue definition includes on-call ownership, accepted consequence classes and tiers, maximum age, backup queue, escalation contacts, and downtime procedure. Routing failure goes to `agent-safety`; it never causes auto-approval.

## Human authority, approval, quorum, and separation of duties

An approval records identity, authenticated role, authority source, decision digest, outcome, reason code, optional conditions, and timestamp. A typed signature or button click without an authority check is not approval.

```ts
type ApprovalPolicy = {
  id: string;
  eligibleRoleSets: string[][];
  quorum: number;
  distinctPeople: boolean;
  separationRules: Array<
    | "not_task_requester"
    | "not_definition_author"
    | "not_deployment_releaser"
    | "not_effect_executor"
    | "different_reporting_line"
    | "different_authority_domain"
  >;
  expiresAfterSeconds: number;
  requireReason: boolean;
};
```

Approvals are deny-by-default, cannot be delegated by the agent, expire, and are consumed exactly once. Conditional approval is enforced as policy, not free text. Self-approval and duplicate identities do not count toward quorum. Break-glass authority requires a declared incident, short expiration, independent post-event review, and a receipt.

### Human authority matrix

`A` means final authority, `Q` means required quorum participant, `C` means consultation or specialist validation, and `—` means no approval authority.

| Effect | Operations | Licensed clinician | Finance | Sponsor/contract owner | Privacy/compliance/legal | Credentialing | Security |
|---|---:|---:|---:|---:|---:|---:|---:|
| Internal R1 reversible annotation | A | C | — | — | — | — | — |
| Clinical recommendation sent externally | C | A | — | — | C when regulated | — | — |
| PA approval under deterministic published criteria | A | A where clinical judgment is required | — | — | C | — | — |
| Coverage denial, termination, or adverse benefit determination | C | Q where clinical | — | Q for plan authority | Q for notice/appeal rules | — | — |
| Low-value claim/payment correction | C | — | A | — | — | — | — |
| High-value or bulk money movement | — | — | Q (two-person finance quorum) | Q when sponsor-funded | C | — | — |
| Benefit or contract change | C | C | C | A | Q | — | — |
| External communication without PHI | A for approved templates | C if clinical | — | C if sponsor-facing | C if regulated | — | — |
| New or exceptional PHI disclosure | — | C | — | — | A | — | C for secure channel |
| Network credentialing or adverse credential action | C | C | — | — | C | A | — |
| Regulatory filing, attestation, or legal response | C | C | C | C | A | — | — |
| Identity, access, secret, or security control change | — | — | — | — | C | — | A |

Tenant contracts and law may require additional authorities. The matrix cannot be weakened by a definition or prompt. R3 effects require at least two distinct humans when more than one authority domain is marked `Q`; one person holding multiple roles cannot satisfy cross-domain quorum.

## Effect execution and external action receipts

After policy and approval, the effect service accepts an `EffectIntent` containing the decision digest, exact payload digest, destination, consequence assessment, approval receipts, idempotency key, expected precondition/version, and compensation plan.

The executor:

1. Rechecks deployment status, task state, policy freshness, approvals, SOD, kill switches, and capability.
2. Compares the target's current version with the approved precondition.
3. Writes an attempt receipt before dispatch.
4. Sends with an idempotency key where supported.
5. Captures the provider response and independently verifies the resulting state.
6. Writes a terminal or `outcome_unknown` receipt and advances the task.

```ts
type ExternalActionReceipt = {
  id: string;
  taskId: string;
  effectIntentId: string;
  attempt: number;
  actionType: string;
  destination: string;
  requestDigest: string;
  idempotencyKey: string;
  executorIdentity: string;
  startedAt: string;
  completedAt?: string;
  transportStatus:
    | "not_sent"
    | "accepted"
    | "rejected"
    | "timeout"
    | "outcome_unknown";
  providerCorrelationId?: string;
  responseCode?: string;
  responseDigest?: string;
  verificationStatus: "pending" | "verified" | "mismatch" | "not_verifiable";
  resultingRecordRef?: string;
  beforeDigest?: string;
  afterDigest?: string;
  compensationIntentId?: string;
};
```

Timeout is not failure and is not safe to retry blindly. `outcome_unknown` blocks further attempts until reconciliation proves the state or an authorized human chooses a safe idempotent recovery.

## Evaluation and release gates

Definitions and deployments advance through `draft → validated → published → deployed`. Production release requires machine-verifiable receipts for:

- Schema, policy, tool-contract, and deterministic unit tests.
- Golden cases for each action, consequence class, risk boundary, refusal, and fallback route.
- Fail-closed tests for unknown actions, malformed payloads, missing policy, stale evidence, unavailable queues, and classifier disagreement.
- Prompt-injection, tool-confusion, data-exfiltration, cross-tenant access, PHI minimization, and adversarial evidence tests.
- Replay against representative historical tasks with deterministic outcome comparison where applicable.
- Quality thresholds by cohort, including false-negative and harmful-action limits—not only aggregate accuracy.
- Human override and inter-rater analysis against a qualified adjudication set.
- Tool timeout, partial failure, duplicate delivery, stale-write, and `outcome_unknown` recovery tests.
- Approval, quorum, SOD, expiry, and decision-digest invalidation tests.
- Compensation, rollback, kill-switch propagation, and audit completeness drills.
- Latency, cost, capacity, and fallback-queue load limits.
- Privacy, security, compliance, clinical, and operational sign-offs required by the deployment's classes.

Hard safety thresholds have zero tolerance unless an approved, statistically justified threshold explicitly says otherwise. Averages cannot mask a failed high-risk cohort.

Release sequence:

1. Offline evaluation.
2. Shadow mode with no effects.
3. Staff-only or synthetic canary.
4. Production canary at the lowest autonomy.
5. Bounded ramp by tenant, population, action, and risk tier.
6. Promotion only after minimum sample size and review-window completion.

Any definition, prompt, model, model configuration, tool contract, consequence rule, policy bundle, evaluator, or data-use change creates a new release candidate. Automatic rollback thresholds are part of the deployment, not decided after an incident begins.

## Observability and audit

The event stream records task admission, state transition, model invocation, policy decision, tool call, evidence creation, decision creation, approval, review obligation, effect attempt, verification, override, compensation, kill-switch change, and release change. Events are append-only, ordered per task, tamper-evident, and correlated by task, run, decision, approval, effect, tenant, subject, deployment, and trace IDs.

Metrics are segmented by agent version, deployment, model, tool version, tenant, action, consequence class, risk tier, population, and autonomy:

- Admission, refusal, hold, escalation, completion, and queue-aging rates.
- Policy-denial and unknown-classification rates.
- Tool denial/error/timeout and evidence freshness/contradiction rates.
- Approval latency, quorum failures, expired approvals, SOD blocks, and review-window breaches.
- External attempts, duplicate prevention, verification mismatch, and unknown outcomes.
- Human override, appeal, reversal, rework, harmful-action, and compensation rates.
- Clinical/coverage timeliness, payment accuracy, disclosure incidents, and contract/SLA adherence.
- Model quality, drift, token/cost/latency, and deterministic-validation disagreement.
- Kill-switch activation and propagation latency.

Alerts favor safety indicators over uptime. In particular, any unauthorized tool attempt, cross-tenant access, R3 auto-effect, approval bypass, unreceipted external action, verification mismatch, or policy/classifier unavailable event pages the relevant control owner and activates the configured hold or kill switch.

Logs and traces use allowlisted fields, tokenization, and retention by data class. Prompts and tool payloads are not copied wholesale into general telemetry. Audit access itself is audited.

## Rollback, compensation, and kill switches

### Rollback and compensation

Code/deployment rollback prevents future use; it does not undo completed effects. Every R1–R3 effect type must declare before release:

- Whether it is reversible.
- The allowed reversal period.
- A deterministic compensation operation or documented human procedure.
- Required authority and quorum for compensation.
- Before-state evidence and verification method.
- Member/provider/sponsor notice obligations.
- Reconciliation and closure criteria.

Compensation is a new authorized effect linked to the original receipt, never a deletion or mutation of history. If compensation could create a second harm, it receives its own consequence assessment and approval. Irreversible effects raise the risk floor and cannot use retrospective review.

A deployment rollback pins traffic to a previously released deployment with compatible policy and tool contracts. In-flight tasks are either completed under their frozen revision, re-evaluated and reapproved under the target revision, or cancelled; they are never silently migrated.

### Kill switches

Kill switches are hierarchical and independently operable by authorized safety, security, clinical, privacy, and platform roles:

- Global agent platform.
- Environment.
- Tenant or sponsor.
- Agent definition or deployment.
- Action type.
- Consequence class.
- Risk tier.
- Tool or external destination.
- Model/provider.
- Subject/population cohort.

Modes are:

- `admission_stop`: reject new tasks.
- `effect_stop`: allow analysis but block all new effects.
- `drain_to_human`: stop automation and route current work to fallback queues.
- `hard_stop`: revoke capabilities, cancel leases, and prevent the next tool/effect boundary.

Switch records include scope, mode, reason, incident ID, activator, start, optional expiry, and reset authority. The runtime consumes push notifications and polls as a backstop. Propagation has a tested service-level objective. Cached `allow` decisions cannot survive a matching switch.

Reset requires the authority named by policy, incident evidence, and—after a high-severity event—independent approval. Restarting a process never clears a switch.

## Required runtime flow

The conforming happy path is:

```text
request
  → authenticate and deduplicate
  → resolve active deployment revision
  → classify scope, consequence, and risk
  → evaluate admission policy
  → create task and frozen authority snapshot
  → collect scoped evidence through capability gateway
  → reason in deterministic/model/hybrid mode
  → validate decision and independently reclassify consequence/risk
  → evaluate effect policy
  → hold for approval/quorum or create review obligation
  → recheck policy, approvals, preconditions, and kill switches
  → execute idempotent effect
  → persist external receipt and verify target state
  → complete review/compensation obligations
  → close task
```

Every arrow is a durable transition. A crash resumes from records and receipts, not from model memory.

## Explicit improvements over the current implementation

The current `src/lib/agents/registry.ts` and `src/lib/agents/runtime.ts` are a useful demo boundary, but they are not sufficient as a PBM control plane. The target model above deliberately changes these weaknesses:

1. **Static mutable meaning becomes immutable identity.** `AGENTS` identifies an agent only by an unversioned string and process code. Runs do not pin definition, prompt, tool contract, model configuration, evaluator, or deployment versions. Replace this with immutable definitions and deployment revisions copied onto every task.
2. **Consequence classification becomes fail-closed and typed.** `isConsequential()` returns `false` when an action is absent from an agent's string list. A typo or newly added action therefore becomes non-consequential. Replace the boolean and negative lookup with the exhaustive `ConsequenceAssessment`; unknown means R4 hold/refusal.
3. **Coverage expands beyond “money or deny care.”** The current boolean omits contract, external communication, PHI disclosure, credentialing, legal/compliance, and security effects, and does not distinguish approval authorities. Persist all applicable typed classes and derive controls from each.
4. **Plain-language `mayNot` becomes enforceable policy.** The registry's prose is valuable documentation but the runtime cannot evaluate it. Encode restrictions as versioned policy rules over action, payload, subject, tenant, destination, data fields, amount, evidence, and time.
5. **Tool names become scoped capabilities.** `Run.tool()` checks only that a string appears in `tools`, then executes an arbitrary caller-provided closure. It cannot enforce arguments, rows, fields, tenant, purpose of use, network destination, side effects, or contract version. Route calls through a gateway with task-bound grants and remove arbitrary effectful callbacks.
6. **Autonomy stops being a direct permission.** `autonomyAt()` falls back to a registry default when no policy exists, and `Run` can be constructed with caller-supplied autonomy. Missing policy must deny admission; constructors must be internal; effective authority must be resolved from all ceilings and frozen in a policy snapshot.
7. **`ActWithReview` gets real semantics.** Today it auto-applies exactly like `Act`, with no review obligation, deadline, queue, breach action, or compensation. Limit it to eligible bounded effects and atomically create the typed review window before execution.
8. **Proposal is separated from effect.** `propose()` marks an item `Applied` based only on autonomy and consequence, before any external executor, precondition check, idempotency handling, receipt, or target-state verification. A proposal should remain a decision until an effect service returns a verified receipt.
9. **Policy is evaluated per action and context.** Current policy lookup supplies only an agent-level autonomy string. Add deterministic admission and effect decisions that record matched rules, risk, classes, approvals, fallback, review window, and policy digest.
10. **Approval becomes a state machine.** `reviewedBy` and `reviewedAt` cannot express authenticated authority, quorum, SOD, expiry, conditions, rejected/abstained votes, or digest binding. Add approval policies, individual votes, quorum calculation, and immutable approval receipts.
11. **Evidence becomes verifiable.** `Run.evidence()` accepts arbitrary summaries and details without source, freshness, provenance, digest, citation, PHI class, or contradiction state. `serialise()` truncates large data and can leave an unauditable fragment. Store immutable evidence metadata plus encrypted content references and exact citations.
12. **Audit survives crashes.** Steps and proposals are buffered in memory and persisted only by `finish()`, so a process failure can erase the attempted run. Append task events, tool calls, policy decisions, approvals, and effect attempts durably as they happen, using an outbox where external delivery is involved.
13. **State and schemas become typed.** Free-form strings for subject, action, status, step kind, and payload allow invalid combinations. Use registered action schemas and command-validated state transitions; reject unknown enum values at write boundaries.
14. **External ambiguity is represented.** Current `autoApplied`/`appliedAt` cannot distinguish accepted, delivered, verified, failed, duplicated, or unknown outcomes. Add attempt and verification receipts, provider correlation IDs, and reconciliation workflow.
15. **Safety controls operate during a run.** There is no kill-switch check at tool/effect boundaries, no lease revocation, no fallback queue, and no policy for draining in-flight work. Add hierarchical switches and repeated checks.
16. **Recovery is designed before authority.** The current model says some work is reversible but does not bind an effect to rollback or compensation. Require a tested compensation declaration and before-state evidence before releasing effect authority.
17. **Confidence is demoted to telemetry.** Current proposals persist model confidence without calibration or control semantics. Confidence may increase scrutiny; it must never independently authorize or auto-apply an effect.
18. **Ownership becomes authority.** Free-text `owner` does not establish who can approve, release, override, compensate, or reset a kill switch. Use authenticated roles, authority sources, the human matrix, and auditable delegation.
19. **Runs distinguish execution mode from mixed telemetry.** The current `brain` label is inferred from observed steps and reports `mixed`; it does not declare or constrain the approved execution architecture. Pin `ExecutionMode` in the definition and separately record every component actually used.
20. **Time and policy consistency become explicit.** Looking up autonomy at run start does not address policy changes before effect, stale approvals, simulated versus wall-clock time, or emergency overlays. Freeze the decision inputs, re-evaluate narrowing controls before effect, and use explicit business and system clocks.

Migration should preserve existing run/proposal records as legacy audit data, not reinterpret them as conforming tasks or verified effects. New automation should first ship in shadow/propose mode behind the task, policy, evidence, and receipt records; authority can increase only after release gates and observed review performance pass.

## Definition of done

The operating model is implemented only when:

- No agent-facing code path can write externally except through the effect service.
- An unknown action demonstrably fails closed in production-equivalent tests.
- Every task and effect can be reconstructed from immutable version and evidence references.
- Every consequential effect shows the policy decision, required human authority, approvals/quorum/SOD result, external receipt, verification, and compensation path.
- `act_with_review` always has an unexpired review obligation and live fallback queue.
- Kill switches block the next protected boundary within the tested propagation objective.
- Evaluations and release receipts are required by deployment activation, not maintained as optional documentation.
- Operations can answer, without reading a model transcript: what was attempted, under which authority, from what evidence, who approved it, what reached the external system, whether it was verified, and how it can be stopped or compensated.
