# CMP-015 Application / Case Management Service

SF-M05-001 (Wave A). Sole owner of authoritative application/case state (Constitution #10).
**Not CERTIFIED.** Builder evidence only; gates are issued by human/CI.

| Field | Value |
|---|---|
| Module / component | M05 / CMP-015 |
| Integrations | INT-004 (submission hot path), INT-005 (post-commit workflow signal), INT-011 (tenant isolation) |
| Frozen contracts consumed | SF-CON-APPLICATION-CASE-SM, SF-CON-COMMAND-TRANSITION, SF-CON-VERSION-PINNING (+ WORKFLOW-MODEL, HUMAN-TASK, SLA-CLOCK as read-only context) and the 13 shared contracts |
| ADRs | ADR-0003, ADR-0005, ADR-0006 |
| Schema / role | `sf_application_case` / `sf_cmp015_rw` (NOLOGIN, NOSUPERUSER, NOBYPASSRLS) |
| Migrations | `db/migrations/1759540150000_cmp-015-application-case.sql`, `db/migrations/1759540150001_cmp-015-outbox.sql` |
| Host mount | Not mounted. `apps/api` composition is SF-M05-009. |

## Command flow (SF-CON-COMMAND-TRANSITION)

1. Short read transaction (RLS-scoped): case snapshot, idempotency lookup, optional request reference.
2. OPA authorization outside any transaction against the current effective published policy; the
   decision `policy_revision` is recorded on the transition, the domain event and the command record
   (ADR-0005). The pin graph is never changed by authorization.
3. Pins/state validation outside the transaction: pin-graph hash integrity, expected_state,
   expected_version, legality, ADR-0003 committed-request gate, and for WITHDRAWN/CANCELLED the
   published service-policy port (default deny).
4. One short PostgreSQL transaction: idempotency claim, `SELECT … FOR UPDATE`, re-validation,
   optimistic `UPDATE … WHERE state = $expected AND aggregate_version = $expected`, append-only
   transition row, domain event + audit event in the outbox, idempotency completion. No outbound port
   can be called while it is open (`tx-scope.ts`; refused with `NETWORK_IO_IN_DOMAIN_TX`).
5. After COMMIT a `CommitReceipt` is issued; only then may `WorkflowAdvanceGate` signal Temporal.
   A failed signal returns `DEFERRED_TO_OUTBOX`; the committed outbox event remains the trigger.

The database repeats the critical invariants: legal-state CHECK (no `*_REQUESTED`), transition-table
trigger, +1 version, immutable pins/identity, committed-and-consumed request required for
WITHDRAWN/CANCELLED, append-only transitions, no DELETE grant.

## Decision boundary (Constitution #20)

`RECORD_APPROVED` / `RECORD_REJECTED` and request resolution to `COMMITTED` / `REJECTED` require a
`decision` attestation: `HUMAN` (OFFICER actor) or `RULES` (SYSTEM actor + `basis_ref`). `AI` is always
refused, and INTEGRATION principals (AI Gateway) can never record a decision.

## Ports (no providers in M05)

OPA (`AuthorizationPort`), published binding (`PublishedBindingPort`), service policy
(`ServicePolicyPort`), Temporal (`WorkflowAdvancePort`), payment, notification, DigiLocker. Simulated
binding/policy adapters are refused in PRODUCTION and non-simulation environments (Constitution #22).

## Dependency-free manifest

`package.json` declares no dependencies so `pnpm install --frozen-lockfile` passes without a
`pnpm-lock.yaml` change (builders must not commit the lockfile). The PostgreSQL store takes a
structural `SqlPool` (node-postgres compatible); the HTTP surface is a framework-neutral
`RouteRegistrar` (Fastify `app.route` compatible). Tests resolve `pg` from `db/` and Ajv from
`packages/contracts/` for frozen-schema validation.

## Commands

```bash
pnpm --filter @serviceform/cmp-015-application-case typecheck
pnpm --filter @serviceform/cmp-015-application-case test:unit
DATABASE_URL=postgres://… pnpm --filter @serviceform/cmp-015-application-case test:integration
```

## Residuals (not in this slice)

- Host mount and real OPA/binding/policy/Temporal adapters: SF-M05-009 and later tasks.
- Governed in-flight re-pin (Constitution #35) has no CMP-015 command; pins are immutable here.
- Assisted-service `applied_by` / `applied_for` (INT-015) is not modelled.
- READ actions are authorized but not written to the audit outbox.
