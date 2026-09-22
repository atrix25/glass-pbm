# Member call simulation

`/member-calls` provides five scenarios for the seeded demonstration members: prescription costs, authorization, denial, refill timing and clinical referral. Start call submits the scripted questions in order to the existing member-service agent. Staff can also enter a standalone question. Select View checks to inspect the tools used for each answer.

The caller is scripted and the service agent uses deterministic routing and composed responses. This is not a telephone or conversational voice integration. Listen uses browser speech synthesis when available. Questions do not share conversation memory; each needs its own drug and context. Transcripts are temporary client state, cleared on scenario change or navigation.

The API requires demo features and accepts only seeded demo member IDs. It runs `answerMember` with `persist: false`: read-only tools execute, but no agent run, proposal, ticket or employee assignment is stored. Non-persisted run identifiers are omitted from the response. The normal application authentication gate still applies.

Validation: `npx vitest run tests/member-calls.test.ts tests/agent.test.ts --reporter=default`. Covers demo gating, input limits, synthetic-member restriction, non-persistence options, errors, clinical referral and historical authorization wording. Browser verification covers multi-question playback, member switching and the clinical referral display.
