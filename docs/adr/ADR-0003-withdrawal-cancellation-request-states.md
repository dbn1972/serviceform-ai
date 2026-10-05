# ADR-0003: Withdrawal and cancellation request constructs are not CMP-015 states

| Field | Value |
|---|---|
| Status | **ACCEPTED** |
| Accepted by | Debabrata Nayak (owner), 5 October 2026 |
| Date | 5 October 2026 |
| Proposed by | Architecture & Contract Guardian (SF-M05-CG-001 pre-freeze decision package) |
| Source | ARCHITECTURE-VERIFICATION-001 finding M-02; AWS v1.7 §12.1; Eng v1.4 §11.1; Constitution #10, #17 |
| Changes | Interprets request vs success for withdrawal/cancellation. No frozen shared-contract change. No Constitution rule rewrite. |
| Artifacts | `contracts/m05/` SF-CON-APPLICATION-CASE-SM, SF-CON-WORKFLOW-MODEL, SF-CON-HUMAN-TASK (all **PROPOSED**, **NOT_FROZEN**; contracts freeze is a later authorized step) |

Accepted by Debabrata Nayak. M05 contracts remain **PROPOSED / NOT_FROZEN**. This acceptance does **not** freeze contracts or start Wave A.

## Context

AWS v1.7 §12.1 lists `WITHDRAWN` and `CANCELLED` as canonical application lifecycle states. Engineering v1.4 §11.1 additionally names `WITHDRAWAL_REQUESTED` and `CANCELLATION_REQUESTED` in the certification-baseline flow corrections. Treating those request labels as first-class CMP-015 states would make a request indistinguishable from a successful domain outcome, force rollbacks when a request is rejected, and let Temporal or a work-queue record appear to own case state.

Constitution #10: application/case state is authoritative in the Application/Case domain; Temporal must not advance an authoritative state change before the domain commit succeeds. Constitution #17: withdrawal/cancellation after submission is service-policy driven and may require an authorized workflow; it is not universally available.

## Decision

1. `WITHDRAWAL_REQUESTED` and `CANCELLATION_REQUESTED` are **not** authoritative CMP-015 states. They are **workflow / request constructs** (human-task and workflow-node kinds) owned by CMP-016/CMP-017 metadata and records.
2. While a withdrawal or cancellation request is under evaluation, the **authoritative CMP-015 state is unchanged**.
3. After an authorized workflow and published service-policy commit, CMP-015 **may** transition to `WITHDRAWN` or `CANCELLED` (from a policy-allowed source state in the AWS v1.7 §12.1 machine). Those two values remain the only withdrawal/cancellation **outcomes** on the case.
4. A rejected or expired request leaves the case in its prior authoritative state. No compensating rollback of case state is required because the request never mutated it.
5. Temporal sequences review; it is not the domain state store.

### Rationale

- **Constitution #10 / #17:** request ≠ success; policy and authorized workflow gate post-submission outcomes.
- **Rejected requests need no rollback** of CMP-015 state.
- **Audit trail:** request create/review/complete is auditable independently of the later (or absent) CMP-015 transition.
- **Temporal ≠ domain state:** orchestration history may show a request node; PostgreSQL CMP-015 remains the case authority.

### MUST (implementation, after human acceptance and a later freeze)

- No named-service, named-officer, named-jurisdiction, or named-tenant branching in domain logic.
- OPA authorizes every protected action (current effective published policy; see ADR-0005).
- GoRules evaluates deterministic eligibility for whether withdrawal/cancellation is offered; it does not commit CMP-015 state.
- Temporal sequences the review process only.
- CMP-015 is the **sole** owner of the final `WITHDRAWN` / `CANCELLED` transition.
- Submit of a request is **idempotent** and retry-safe.
- Request and outcome are **auditable** (SF-CON-AUDIT-EVENT as frozen).
- An AI model **cannot** approve or reject the request or the statutory case outcome (Constitution #20).

## Consequences

- SF-CON-APPLICATION-CASE-SM enumerates AWS v1.7 §12.1 legal states only; the two `*_REQUESTED` tokens are forbidden as `application_state`.
- SF-CON-WORKFLOW-MODEL includes canonical nodes for withdrawal/cancellation **request** and **review**.
- Builders must not persist `WITHDRAWAL_REQUESTED` / `CANCELLATION_REQUESTED` on the case row.
- This ADR does not freeze contracts. Freeze is a later, separately authorized SF-M05-CG-001 step.
- Every CMP-015 transition whose `to_state` is `WITHDRAWN` or `CANCELLED` is **policy-gated** (published service policy + authorized workflow/request commit). None is `ALWAYS_LEGAL`.

## Acceptance record

Accepted 5 October 2026 by Debabrata Nayak. `WITHDRAWAL_REQUESTED` / `CANCELLATION_REQUESTED` are workflow/request constructs, not CMP-015 states. While pending, CMP-015 state is unchanged. Only after configured policy/workflow resolution may CMP-015 commit `WITHDRAWN` or `CANCELLED`. A rejected or expired request leaves case state unchanged. Temporal orchestrates; CMP-015 is the sole authoritative owner.
