# CMP-017 Work Queue / Human Task Service (SF-M05-003)

Status: builder output, **not verified, not certified**. Independent verification (opus route) is a separate step.

Human-task lifecycle for officer work: `create`, availability, `claim`, `unclaim`, `reassign`, `complete`,
`cancel/close`, history and assignment resolution. Shape of every lifecycle record and event is the FROZEN
`SF-CON-HUMAN-TASK` (read-only, `contracts/m05/`).

## Rules this component enforces

| Rule | Where |
|---|---|
| Assignment = role + organisation/office + jurisdiction + service scope; never a person (Constitution #19) | `src/domain/assignment.ts` (strict allow-list, `NAMED_OFFICER_FORBIDDEN`), DB `CHECK` on `role_code`, no person column |
| Runtime claimant is recorded, not published metadata | `claimed_principal_id` is written only by `claim`, cleared by `unclaim`/`reassign`, never accepted from input |
| Tenant is server-derived | `src/context.ts` refuses tenant/role/actor headers; body `tenant_id` refused; RLS `FORCE` + `sf_platform.current_tenant_id()` |
| OPA on every protected action, current effective policy (ADR-0005) | `src/authz.ts`; decision `policy_revision` + `decision_id` stored in `task_history` and audit `reason` |
| No network call in a DB transaction | OPA decision and principal-scope lookup run before the short write transaction |
| Terminal tasks are immutable | `COMPLETED` / `CANCELLED_CLOSED` rejected in service **and** by trigger `sf_tasks.guard_task_transition` |
| Optimistic concurrency | OPA decision is bound to the task `aggregate_version`; a concurrent change returns `STALE_TASK_VERSION` |
| No cross-component SQL | `src/sql.ts` guard + static test; DB privilege role `sf_cmp017_rw` (ADR-0006) |
| Idempotent commands | `sf_tasks.idempotency_record`, scope = tenant + principal + endpoint + key |
| Outbox + audit | `sf_tasks.outbox_event` (frozen SF-CON-OUTBOX template), topic `sf.tasks.events.v1`; audit to `sf.audit.ingest.v1` |

## OPA action codes

`TASK_CREATE`, `TASK_CLAIM`, `TASK_UNCLAIM`, `TASK_FORCE_UNCLAIM` (releasing another principal's claim),
`TASK_REASSIGN` (evaluated for the current criteria and again for the target criteria),
`TASK_COMPLETE`, `TASK_CANCEL_CLOSE`, `TASK_READ`, `TASK_READ_HISTORY`, `TASK_LIST`.

Resource attributes sent: `task_id`, `application_id`, `organisation_id`, `jurisdiction_id`, `service_id`
(= service scope), `owner_id` (current claimant), `workflow_context.{workflow_node_id, required_role, task_state}`.

## Design notes and assumptions for the verifier

1. **Transport-neutral.** `createTaskHandler` takes a plain `HttpRequest` and returns an `HttpResponse`. No
   Fastify, no `apps/api` mount (deferred to SF-M05-009). The host adapts its framework request.
2. **Dependency-free workspace project.** `package.json` declares no dependencies so the builder slice does not
   touch `pnpm-lock.yaml` (frozen-lockfile CI still passes). Shared contracts are imported by relative path from
   `packages/contracts/src` (`src/contracts.ts`); the PostgreSQL driver is reached through the `SqlPool` port
   (structurally satisfied by `pg.Pool`). STITCH-A may swap `src/contracts.ts` to `@serviceform/contracts` and add
   the importer; no other source change is needed.
3. **`task_state` in `SF-CON-HUMAN-TASK` events is the state after the operation.** The frozen schema does not say
   whether it is pre- or post-state. Post-state is used; this is not a contract change. Flag for the verifier.
4. **`outcome` is an opaque action code** supplied by the caller on `complete`/`cancel`. CMP-017 makes no
   statutory decision; deterministic decisions stay with CMP-015/CMP-016 and GoRules.
5. **Principal coverage** comes from the server-derived request context, optionally widened through
   `PrincipalScopePort` (jurisdiction descendants, offices, service scopes) backed by the owning components' APIs.
   The default port adds nothing. Both OPA and assignment resolution must allow `claim` and `complete`.
6. **Cross-tenant ids return 404** (`SF-SYS-002`), not 403, so task existence in another tenant is not disclosed.
   Tenant hints in headers/body return 403 (`SF-TEN-002`).
7. **INT-005**: the OPA decision for an officer action is obtained and recorded before the task transition is
   committed; CMP-016 consumes `HumanTaskClaimed/Completed/...` events after the domain commit (Temporal is never
   signaled before commit). **INT-011**: tenant isolation chain is exercised by FORCE RLS and cross-tenant tests.
8. The `sf_tasks.outbox_event` table inherits the frozen template grant `INSERT ... TO sf_app` (ADR-0006
   condition 9). It is the only CMP-017 table another component login can write to.

## Tests

```bash
pnpm exec vitest run --root services/cmp-017-work-queue-tasks --config services/cmp-017-work-queue-tasks/vitest.unit.config.ts
DATABASE_URL=... pnpm --dir services/cmp-017-work-queue-tasks test:integration   # needs PostgreSQL 16
```

Unit/contract tests also run in the repository-wide `pnpm test:coverage`. Integration tests apply the real
migrations, create real LOGIN roles (`IN ROLE sf_app, sf_cmp017_rw`, no `SET ROLE` shortcut) and use the actual
`PgTaskRepository`.
