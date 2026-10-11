# Pre-leakage restoration

Restores the September 17 checkpoint `c6428b4`, the last saved version before the first leakage release (`d28d67b`). That release combined the later sponsor redesign, account management, member calls, and leakage features, so those additions are absent from this checkpoint.

The complete later application is named **Rebate monitoring platform**, with release/tag `rebate-monitoring-platform` and branch `codex/rebate-monitoring-platform`, both pointing to `e63abe1`. It also remains on `codex/glass-connected-demo` and tag `glass-longitudinal-book-e63abe1` at `e63abe1`. This restoration is on `codex/restore-pre-leakage`; no history was rewritten.

Compatibility exceptions: retain the current signed demo login and Next.js proxy convention, exclude local credentials from Docker images, redirect primary retired demo URLs to the sponsor dashboard, and disable automatic schema synchronization on startup. Existing database records and newer sandbox tables are retained. Deploy only the app process, leaving the worker unchanged.

Validation also updates the legacy prior-authorization test to calculate PostgreSQL timestamp intervals in seconds rather than SQLite milliseconds; the expected 24/72-hour limits are unchanged.
