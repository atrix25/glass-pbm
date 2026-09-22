# Agent work visibility

The agent workspace offers Overview, Work and Team tabs. Registered roles describe responsibility, not employee assignment. No new approval, assignment or messaging actions are added.

Work records distinguish runs from proposals. All activity may therefore show multiple proposals and their parent run. Pending counts include proposed non-consequential work, not just historical consequential actions. Failed-run counts apply only to runs. Server-side search, filters and 25-row pagination share the same SQL status interpretation as the overview.

Recorded runs become visible only after their end timestamp. Proposed work without review or application timestamps awaits review. Dated approvals without application await action. Applied, rejected and withdrawn states require supporting timestamps. Future events and inconsistent or incomplete history produce Status unavailable rather than a reconstructed state. Unknown states are displayed separately from pending counts. PostgreSQL comparisons explicitly normalize cutoff timestamps to UTC to match Prisma's timestamp columns.

Detail views show requests, ordered agent steps, proposals, dated reviews and recorded applications. Steps have no individual timestamps. Employee identity and override notes are shown only when their review date is within the cutoff. Related runs share a subject reference but do not establish a handoff. Raw payloads, execution details and current registry permissions are collapsed.

Agent ownership and source routes come from the registry and a fixed queue map. Only prior authorizations have a supported record-level link; remaining destinations use Open work queue. Estimates of staff time are not measured savings. The page recalculates on load or Refresh, without claiming live execution tracking.

Validation includes pure status cases, read-only PostgreSQL status fixtures, comparison of SQL and detail status for recorded proposals, count/list reconciliation, filtered pagination, empty states, and responsive browser checks. No migration or new mutation API is required.
