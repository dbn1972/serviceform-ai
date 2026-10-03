# Dispatch plan: M01 wave 1 (re-verified at 126ded1)

| Field | Value |
|---|---|
| Prompt | `prompts/07_MULTI_AGENT_ORCHESTRATOR.md` |
| Orchestrator | Opus-routed; this pass writes orchestrator artifacts only, no application code |
| Date | 3 October 2026 |
| Repo | `dbn1972/serviceform-ai` |
| Verified HEAD | `126ded198235230982aba0d377061573969ff7ee` (`origin/main`, clean) |
| Orchestrator branch | `cursor/m01-wave1-dispatch-b828` |
| Builders launched | **None** |
| Result | **READY_TO_DISPATCH** |

Supersedes the CLAIMED registry/queue on `de0ac12` (no `agent/*` branches on origin, no `services/**` implementation). Historical plan: `orchestrator/dispatch/DISPATCH-PLAN-M01-W1.md`.

## 1. Dependency-ready work

M00 is the only completed module. M01 is the only module whose module-level `depends_on` is satisfied. M02+ remain BLOCKED on M01.

M00 gate: `G1_BUILD_READY` is **recommended** by `evidence/M00/BOOTSTRAP-EVIDENCE-001.md` (20/20 local checks) and the 684b443 re-run. It is **not independently certified**. Owner accepted ADR-0001/0002/0004 and froze contracts; that is treated as sufficient to dispatch M01, not to certify G1.

Inside M01, five components have no code dependency on another M01 component (seams are FROZEN contracts only):

| Wave | Components | State |
|---|---|---|
| W1 (this plan) | CMP-002, CMP-048, CMP-031, CMP-038, CMP-037 | READY |
| W2 | CMP-003, CMP-030, CMP-032, CMP-036, CMP-047, CMP-055 | BLOCKED on W1 merges or single-writer paths |

## 2. Contract freeze status

`scripts/gates/contracts_lock_gate.py`: **PASS**. 13/13 contracts **FROZEN**. File hashes match `orchestrator/contracts-lock.yaml` (including SF-CON-OUTBOX and SF-CON-DB-SESSION-CONTEXT companions).

No task is dispatched against a non-FROZEN required contract. Workers consume contracts; they do not edit `contracts/**`.

ADR-0006 (per-component `sf_<component>_rw` roles) is **PROPOSED**. Implement provisionally (PLAN-REVIEW X-1). **Do not merge** until the owner accepts or refuses (O-5).

## 3. Five-agent dispatch (do not spawn here)

| Task | Role / agent | CMP / INT | Write scope | Frozen contracts | Required gate |
|---|---|---|---|---|---|
| SF-M01-001 | `component_builder` / `serviceform-foundation-builder` (opus, high) | CMP-002 / INT-011 | `services/cmp-002-tenant-organisation/**`, `db/migrations/*_cmp-002-*.sql` | COMMON, REQUEST-CONTEXT, ERROR-*, EVENT-ENVELOPE, IDEMPOTENCY, AUDIT-EVENT, AUTHZ-DECISION, ISOLATION, DB-SESSION-CONTEXT, OUTBOX | G4 tenant-negative/RLS on this component; no self-certify |
| SF-M01-002 | `component_builder` / `serviceform-foundation-builder` (opus, high) | CMP-048 / INT-011 | `services/cmp-048-security-platform/**`, `packages/security/**`, `policy/opa/**`, `db/migrations/*_cmp-048-*.sql` | same + AUTHZ-DECISION | G4 OPA deny + RLS; no `infra/local` writes |
| SF-M01-003 | `component_builder` / `serviceform-foundation-builder` (opus, high) | CMP-031 / INT-011 | `services/cmp-031-audit-ledger/**`, `packages/audit-client/**`, `db/migrations/*_cmp-031-*.sql` | same as 001 | G4 append-only ledger + RLS |
| SF-M01-004 | `component_builder` / `serviceform-foundation-builder` (opus, high) | CMP-038 / INT-011, INT-013 | `services/cmp-038-event-bus/**`, `packages/outbox/**`, `db/migrations/*_cmp-038-*.sql` | COMMON through OUTBOX | G3/G4: no lost committed events |
| SF-M01-005 | `component_builder` / `serviceform-integration-builder` (sonnet, high; opus verifier) | CMP-037 / INT-013 | `services/cmp-037-integration-hub/**`, `packages/connector-sdk/**`, `simulators/framework/**`, `db/migrations/*_cmp-037-*.sql` | same + CONNECTOR-BINDING, SIMULATION-MARKER | G4: production refuses SIMULATED critical connectors |

`pnpm-lock.yaml` is the only shared write; regenerate via `pnpm install`, never hand-edit. `check_scope.py` also allows `orchestrator/handovers/<task>.yaml` and `evidence/<task>/**`.

Plans are already approved with conditions (`PLAN-REVIEW-M01-W1.md`). Negative tests and SECURITY-PRECHECK are binding. Workers start implementation against this HEAD, not a second plan-only cycle, unless a stop condition fires.

## 4. Branches and worktrees

Merge this orchestrator PR first, then create worker worktrees from the merge SHA so `check_scope.py --base origin/main` only sees component files:

```bash
git worktree add -b agent/M01-cmp-002-tenant-organisation-SF-M01-001 ../wt-SF-M01-001 <sha>
git worktree add -b agent/M01-cmp-048-security-platform-SF-M01-002 ../wt-SF-M01-002 <sha>
git worktree add -b agent/M01-cmp-031-audit-ledger-SF-M01-003 ../wt-SF-M01-003 <sha>
git worktree add -b agent/M01-cmp-038-event-bus-SF-M01-004 ../wt-SF-M01-004 <sha>
git worktree add -b agent/M01-cmp-037-integration-hub-SF-M01-005 ../wt-SF-M01-005 <sha>
```

Local worktrees were created on this orchestrator pass for isolation; worker branches are **not** pushed and **not** claimed.

## 5. Envelope paths

- `orchestrator/tasks/SF-M01-001.yaml`
- `orchestrator/tasks/SF-M01-002.yaml`
- `orchestrator/tasks/SF-M01-003.yaml`
- `orchestrator/tasks/SF-M01-004.yaml`
- `orchestrator/tasks/SF-M01-005.yaml`

Registry: `orchestrator/agent-registry.yaml`. Queue: `orchestrator/work-queue.yaml`. Locks: `orchestrator/contracts-lock.yaml` (unchanged this pass).

## 6. Non-dispatch / merge holds

- Independent evidence verifier has not certified M00 G1.
- ADR-0006 PROPOSED (O-5) blocks W1 merge, not dispatch.
- P-002-1 compose OPA auth: SF-M01-002 must run authenticated OPA in its test harness; `infra/local/**` stays read-only until an owner write-path exception.
- CI never run on GitHub (G-01): no merge to main until green CI.
- UX4G not vendored: does not block M01 W1.
- Do not auto-approve ADRs, contract changes, security exceptions, or certification.

READY_TO_DISPATCH
