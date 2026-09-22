# Data agent checks

`/data-agent-checks` is a demo-gated QA workspace. The registered data-agent-tester belongs to Quality assurance · Analytics. It asks the existing `answerDataQuestion` implementation questions rather than fabricating answers or testing a separate mock agent.

The predefined set covers spend, paraphrasing, rebates, guarantees, trends, high-cost drugs, prior authorization, formulary rules, a missing claim, an unknown employer budget, future uncertainty and a request to change a contract. Custom questions are supported, with no automatic claim of answer correctness. Selection is scripted; execution reports whether the data agent actually used a model or its deterministic fallback.

Each run freezes its question set and simulation cutoff. One question executes per POST, sequentially, against the existing synthetic Wisconsin-backed book. Tennessee has no connected analytics book and is blocked from execution and transcript access. It is not populated from Wisconsin under a Tennessee label. A pinned cutoff before a run's cutoff hides that run.

Transcripts persist in DataAgentCheck, outside AgentRun, AgentProposal and operational work queues. The agent uses `persist:false`; it reads actual reporting tools but does not write production workflow records. This is not a snapshot of the underlying database: subsequent source-data changes can change answers on a new run.

Create keys and per-question indices make retries idempotent after results are saved. A five-minute lease prevents overlapping execution of a question. After a process crash, the lease expires and an unanswered question can be retried; that may incur another model call, but there is only one saved answer. Closing the page stops further scheduling; reopening allows continuation. No background execution is claimed.

Automatic checks inspect response presence, tool errors, expected routing, required tools, source presence, missing-record handling, and a limited set of exact book-total tokens. They do not independently audit the reporting queries, verify every numerical statement, evaluate all citation entailment, or establish clinical/financial correctness. The page explicitly retains factual review for every answer. Unsupported/custom questions require judgment rather than earning a green correctness grade.

The current implementation is a reproducible question-bank tester, not an adaptive adversarial LLM examiner. Full transcripts, tool arguments, result data, evidence cutoff, execution mode and elapsed time can be inspected/exported. No real member data is introduced by this feature.

Verification: focused evaluator, service-isolation/concurrency, access/schema tests; agent catalog and work regressions; typecheck/build; complete local and deployed playback with actual tool-backed answers. Demo mode and existing authenticated access are required; writes require same-origin requests.
