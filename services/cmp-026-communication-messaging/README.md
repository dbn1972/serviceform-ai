# CMP-026 Communication / Messaging Service

SF-M06-003 (CG-02 Wave A). Case-scoped, participant-scoped, tenant-scoped two-way threads between a
citizen and authorized officials. **Not CERTIFIED.** Builder evidence only; gates are issued by
human/CI. Host mount is deferred to SF-M06-005.

| Field | Value |
|---|---|
| Module / component | M06 / CMP-026 |
| Integrations | INT-011 (tenant isolation), INT-013 (SIMULATED port markers) |
| Frozen contract consumed | `SF-CON-MESSAGE-THREAD` (plus the 24 envelope locks); unchanged |
| Schema / role | `sf_messaging` / `sf_cmp026_rw` (NOLOGIN, NOSUPERUSER, NOBYPASSRLS) |
| Migrations | `db/migrations/1759542600000_cmp-026-communication-messaging.sql`, `db/migrations/1759542600001_cmp-026-outbox.sql` |

## Behaviour

- A thread belongs to one tenant and one opaque `application_id` (case). Participants are named by
  `actor_id` + `role_code`; the case/identity side is consulted only through `CaseParticipationPort`
  (default: deny). A participant may never carry another tenant.
- Messages and official notices are append-only. A UI "delete" is a `message_retraction` tombstone:
  the body is masked in views but the authoritative row and audit trail remain. Official notices are
  immutable and cannot be retracted; they may require acknowledgement (`ack_required`, optional
  `ack_due_at` supplied by the caller, never computed from statute here).
- Non-participants, removed participants and other tenants all receive the same 404 as a missing
  thread (no existence oracle). Authorization is an OPA decision per action; any error or malformed
  decision denies.
- Read receipts are monotonic per participant. Thread lifecycle: `OPEN -> CLOSED -> OPEN|ARCHIVED`
  with optimistic `expected_status` / `expected_version`.
- Participant references in views and events are opaque hashes (`p-...`), never raw principal ids.

## Attachments (CMP-032 port only)

Attachments are `storage_key` references. `AttachmentStoragePort` (CMP-032) verifies the object
exists for the tenant and is scanned `CLEAN` before the message commits, and issues short-lived
download grants. CMP-026 owns no object store, holds no provider credentials and never proxies
bytes. Port calls happen only outside the domain transaction (`guardOutboundPort`). The SIMULATED
adapters are refused outside LOCAL/CI/DEVELOPMENT/SIT/PERFORMANCE.

## Events

Topic `sf.messaging.events.v1`: `ThreadOpened`, `ThreadStatusChanged`, `ThreadParticipantAdded`,
`ThreadParticipantRemoved`, `CaseMessageSent`, `CaseMessageRetracted`, `NoticeAcknowledged`; audit
on `sf.audit.ingest.v1`. Events carry opaque participant refs and a content digest, never body text.
External channel fanout (CMP-025) is asynchronous and driven from the committed outbox.

`package.json` declares no dependencies so the root lockfile is untouched. The workspace importer
line for this package is the expected `EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL`.
