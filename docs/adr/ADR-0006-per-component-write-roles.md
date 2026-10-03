# ADR-0006: Each component's table writes go through its own database role

| Field | Value |
|---|---|
| Status | **PROPOSED** (applied provisionally in M01 wave 1 by orchestrator ruling; owner acceptance required before the first wave-1 merge) |
| Date | 3 October 2026 |
| Proposed by | Claude (orchestrator), from SECURITY-PRECHECK-M01-W1 finding X-1 |
| Changes | Database role model. Frozen contracts unchanged. |

## Context

The platform baseline grants table privileges to one group role, `sf_app`, which every component's
login joins. A grant to `sf_app` therefore reaches every component, so the constitution rule that no
component writes another component's tables holds only by convention. In wave 1 this would let any
component forge audit-ledger rows, mint break-glass grants, activate policy revisions or rewrite the
topic registry inside a tenant it holds context for. RLS does not help: it separates tenants, not
components.

## Decision

1. Each component migration creates a NOLOGIN role `sf_<component>_rw` and grants that component's
   DML (INSERT/UPDATE/DELETE and any sequence use) to it, never to `sf_app`.
2. RLS policies stay `TO sf_app`. A component's runtime login is `IN ROLE sf_app, sf_<component>_rw`
   and holds no other component's `_rw` role. `sf_app` itself gets only the reads another component
   legitimately needs (none in wave 1).
3. Outbox and inbox tables keep the grants the frozen SF-CON-OUTBOX template defines; tightening them
   needs a Contract Change Request.
4. Security-relevant state changes (grants, policy activation, tenant status, ledger head) also carry
   state-machine triggers, so the control does not depend on the role model alone.

## Consequences

- Cross-component writes become a database error, testable in CI.
- Deployment creates one login per component (credentials from the secrets provider, never committed).
- If refused: wave-1 code drops the `_rw` grants back to `sf_app`; the triggers remain, and the residual
  is recorded as an unresolved security risk in each handover.
