# ADR-0006: Each component's table writes go through its own database role

| Field | Value |
|---|---|
| Status | **ACCEPTED** |
| Accepted by | Debabrata Nayak (owner), 3 October 2026 — Option A with the ten mandatory privilege-layer conditions below |
| Date | 3 October 2026 |
| Proposed by | Claude (orchestrator), from SECURITY-PRECHECK-M01-W1 finding X-1 |
| Changes | Database privilege model. Frozen contracts unchanged. Constitution #23 enforced at PostgreSQL GRANT/REVOKE, not application convention. |

## Context

The M00 platform baseline grants table DML to one group role, `sf_app`, which every component
login joins. A grant to `sf_app` is therefore a grant to every component, so Constitution #23
(no component writes another component's authoritative tables) holds only by convention. RLS
separates tenants, not components. Without a component privilege boundary, a Wave 1 service that
holds tenant context can forge audit-ledger rows, mint break-glass grants, activate policy
revisions, or rewrite the topic registry.

## Decision

**Option A**, as constrained by the owner on 3 October 2026:

Wave 1 canonical NOLOGIN privilege roles (names are normative; PLAN-REVIEW-M01-W1 `sf_tenant_org_rw`
/ `sf_security_rw` / `sf_audit_rw` / `sf_event_bus_rw` / `sf_integration_hub_rw` are superseded):

| Component | Privilege role |
|---|---|
| CMP-002 | `sf_cmp002_rw` |
| CMP-031 | `sf_cmp031_rw` |
| CMP-037 | `sf_cmp037_rw` |
| CMP-038 | `sf_cmp038_rw` |
| CMP-048 | `sf_cmp048_rw` |

Later components follow `sf_cmpNNN_rw` with the same rules.

### Mandatory conditions (all MUST)

1. **`sf_app` holds no generic DML** on component-authoritative tables. It remains the common role
   for applicable RLS/policy membership (`TO sf_app`) and for explicitly approved common access
   only. Component INSERT/UPDATE/DELETE (and sequence use for those tables) is granted to that
   component's `_rw` role, never to `sf_app`.
2. **Every component privilege role is `NOLOGIN`**, including `sf_cmp002_rw`, `sf_cmp031_rw`,
   `sf_cmp037_rw`, `sf_cmp038_rw`, and `sf_cmp048_rw`.
3. **Runtime LOGIN roles inherit only `sf_app` and their own component-specific privilege role(s).**
   They must not inherit another component's `_rw` role.
4. **Runtime application roles never have `SUPERUSER` or `BYPASSRLS`.**
5. **Runtime application roles must not own authoritative schemas/tables.** Schema/table ownership
   and DDL/migration privileges belong to a separate deployment/migration role (`sf_migrator` or
   equivalent) that is never used as an application runtime identity.
6. **All TENANT_SCOPED authoritative tables continue to use PostgreSQL `FORCE ROW LEVEL SECURITY`.**
   Per-component grants do not replace tenant RLS. Policies keep using
   `sf_platform.current_tenant_id()`.
7. **Default cross-component SQL access is DENY** for both reads and writes. Do not grant another
   component SELECT/INSERT/UPDATE/DELETE for integration convenience. Components integrate through
   published APIs, events, and approved derived projections. Any exception requires an explicit
   architecture review/ADR.
8. **Revoke unintended `PUBLIC` and generic-role privileges.** `ALTER DEFAULT PRIVILEGES` (and
   equivalent) must not recreate broad access for newly created component tables or sequences.
9. **Preserve SF-CON-OUTBOX exactly as currently frozen.** Do not change its grants as an implied
   consequence of this ADR. Copy `contracts/shared/sql/outbox.template.sql` unchanged. Any
   tightening of the frozen outbox contract requires a Contract Change Request.
10. **Executable database privilege-boundary tests** for every component runtime login must prove:
    - own authorized DML succeeds;
    - wrong-tenant operations fail through RLS;
    - another component's SELECT/INSERT/UPDATE/DELETE fail;
    - membership / `SET ROLE` into another component `_rw` role is unavailable;
    - `BYPASSRLS` is false;
    - the runtime login is not the authoritative table owner.

State-machine triggers on security-relevant transitions (isolation-class/cell placement,
break-glass, policy activation, ledger head) remain required in addition to this role model.

## Consequences

- Cross-component SQL becomes a database error, tested in CI (condition 10).
- Deployment creates one LOGIN per component, credentials from the secrets provider, never
  committed. Each login is `IN ROLE sf_app, sf_cmpNNN_rw` only.
- Migrations run as `sf_migrator` (or equivalent), not as a component runtime login.
- Wave 1 builders implement `_rw` roles and privilege-boundary tests; they do not edit frozen
  outbox grants.
- Local/CI harnesses create real LOGIN roles (SECURITY-PRECHECK X-2 / PLAN-REVIEW X-12). They
  must not `SET ROLE` from a superuser session as a substitute for a real login.
