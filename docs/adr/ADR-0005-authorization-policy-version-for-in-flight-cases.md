# ADR-0005: Runtime authorization uses current effective published policy

| Field | Value |
|---|---|
| Status | **PROPOSED** (not ACCEPTED; human-only acceptance) |
| Accepted by | _pending authorized human approver_ |
| Date | 5 October 2026 |
| Proposed by | Architecture & Contract Guardian (SF-M05-CG-001 pre-freeze decision package) |
| Source | ARCHITECTURE-VERIFICATION-001 finding M-03; AWS v1.7 §20.11, §20.15; Constitution #8, #9, #35 |
| Changes | Separates runtime authorization revision from pinned statutory/config graph. **No change** to the existing 13 frozen shared contracts, including SF-CON-AUTHZ-DECISION. |
| Artifacts | `contracts/m05/` SF-CON-VERSION-PINNING, SF-CON-COMMAND-TRANSITION (all **PROPOSED**, **NOT_FROZEN**) |

This ADR is **not** accepted by this package. Only a human approver can set status to ACCEPTED.

## Context

AWS v1.7 §20.11 places `authorization_policy_version_id` on the TenantServiceBinding (TSB) that applications pin at submission. Constitution #9 requires every submitted application to pin the exact published TSB and executable dependency versions. AWS v1.7 §20.15 says that when tenant policy changes while a case is in flight, **authorization uses effective published policy according to governance**, while workflow/form/rule business versions remain pinned, and that behavior must be explicit and auditable.

If runtime OPA used only the submit-time authorization bundle, a revoked role or tightened deny would not apply to in-flight officer actions. If execution unpinned form/rules/workflow/SLA whenever authorization moved, in-flight statutory reproduction would break (Constitution #8, #9, #35).

## Decision (PROPOSED)

1. **Runtime authorization is NOW.** Each protected action is authorized against the **current effective published** authorization policy. Submit-time freeze of authorization **decision** policy is **not** used.
2. Record, per existing frozen audit and authorization contracts (do not extend them in this package):
   - `policy_revision` (SF-CON-AUTHZ-DECISION output, already required)
   - timestamp (`occurred_at` on SF-CON-AUDIT-EVENT)
   - actor and context (SF-CON-AUDIT-EVENT / SF-CON-REQUEST-CONTEXT)
   - resource and action
   - result (`allow` / audit `result`)
   - reason (`reason_code` / audit `reason` where the frozen audit contract requires it)
3. **Execution still pins** TenantServiceBinding, workflow, form, rules, evidence-policy, SLA, and other statutory/config versions. Those pins are **immutable** for the in-flight application unless a governed migration (Constitution #35) explicitly repoints them. No silent config repoint.
4. If a TSB row already has `authorization_policy_version_id`, **do not remove or mutate it**. Treat it as **publication / provenance** of the access-policy bundle that was current at publish time, unless a later **accepted** ADR says otherwise.
5. For the protected action itself, the OPA decision's `policy_revision` is **authoritative** for that action. It is not replaced by the TSB provenance field.

### Frozen-contract impact (blocking)

SF-CON-AUTHZ-DECISION already carries `policy_revision` on the decision output. SF-CON-AUDIT-EVENT already carries actor, action, resource, timestamp, result, and reason (when `action_class` requires it). **This proposed ADR does not require a semantic change to any of the existing 13 frozen contracts.** Therefore this package records `ccr_required: false`.

If a later design needs new fields on SF-CON-AUTHZ-DECISION (or any other of the 13): **STOP**, file a Contract Change Request, and do not patch the frozen file.

## Consequences

- SF-CON-VERSION-PINNING distinguishes the **pinned execution graph** from **runtime `policy_revision`**.
- Officers who lose a role mid-task are denied on the next action (AWS v1.7 §20.15); the case pins do not freeze that grant.
- Reproduction of a past action uses the audit/`policy_revision` recorded for that action, not a reconstructed “submit-time OPA bundle” as the live PDP input.
- This ADR does not freeze M05 contracts and does not append `orchestrator/contracts-lock.yaml`.

## Recommendation to the human approver

**Recommend ACCEPT** as written (current effective published authorization; statutory config remains pinned). Alternative (freeze authorization at submit for the whole case) is **not** recommended: it conflicts with AWS v1.7 §20.15 fail-closed officer-loss and policy-update behavior.
