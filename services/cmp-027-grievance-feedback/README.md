# CMP-027 Grievance & Feedback Service

SF-M05-007 (Wave B). Generic metadata-driven grievance and feedback. **Not CERTIFIED.**
Builder evidence only; gates are issued by human/CI. Host mount is deferred to SF-M05-009.

| Field | Value |
|---|---|
| Module / component | M05 / CMP-027 |
| Integrations | INT-011 (tenant isolation); workflow/task **ports only** |
| Schema / role | `sf_grievance` / `sf_cmp027_rw` (NOLOGIN, NOSUPERUSER, NOBYPASSRLS) |
| Migrations | `db/migrations/1759541270000_cmp-027-grievance-feedback.sql`, `db/migrations/1759541270001_cmp-027-outbox.sql` |

Routing, category, and assignment come from published policy metadata (role + organisation/office +
jurisdiction + service scope). There is no `if (service == X)` / department / scheme branching.
CMP-016 and CMP-017 are not imported; Temporal/human-task effects run after domain commit via ports.
Notification is an M06 port only. AI may classify, summarize, suggest routing, draft, or flag
duplicates; it cannot close a statutory grievance, record a legal disposition, or decide
entitlement or appeal rights.

`package.json` declares no dependencies so the root lockfile is untouched.
