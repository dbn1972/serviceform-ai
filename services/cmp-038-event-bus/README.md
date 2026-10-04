# CMP-038 Event Bus

Metadata-driven topic registry, transactional outbox library (`@serviceform/outbox`), and relay.

## Schema registry strategy

Topic and event-schema versions are declared in `registry/topics.json` (CODEOWNERS: CMP-038). `registry:sync` upserts `sf_event_bus.topic` / `event_schema` (INSERT-only schemas; incompatible versions fail with `SF-SYS-003` / `SCHEMA_INCOMPATIBLE`). The relay does **not** read those tables: it uses the snapshot shipped in `@serviceform/outbox` (PLAN-REVIEW Q2). A DB row that is not in the snapshot does not change publish behaviour.

JSON Schema compatibility (`BACKWARD` / `FORWARD` / `FULL`) is checked in process before INSERT.

## Roles (ADR-0006)

- `sf_cmp038_rw` NOLOGIN holds DML on registry tables only (GRANT-only, **no RLS**).
- Runtime LOGIN: `IN ROLE sf_app, sf_cmp038_rw`.
- Relay LOGIN: `IN ROLE sf_outbox_publisher` only.
- Schema/table owner: `sf_migrator`.

Outbox/inbox DDL and grants are copied from frozen `SF-CON-OUTBOX` without changes.
