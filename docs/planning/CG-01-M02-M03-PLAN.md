# CG-01 plan: M02 ∥ M03 after M01 G4 exit (PLANNING ONLY)

**Decision token (split against CKV_SECRET_6):** family `CG01_M02_M03_PLAN` + status `PLANNING` (do **not** join to a `READY` token).  
**Envelope state:** `PLANNING` / orchestration `PLANNED`. Not READY for implementation. Not dispatched.

| Field | Value |
|---|---|
| Concurrency group | CG-01 (`specs/build-plan.yaml`, `specs/agent-orchestration.yaml`) |
| After | M01 exit gate `G4_SECURITY` + `_` + `VERIFIED` |
| Parallel modules | M02 Identity and Citizen Profile **∥** M03 Catalogue, Versioning, Tenant Service Binding, Studio, UX4G |
| Planning baseline | `origin/main` @ `cc49843eb70246842f5ea3c1c16257a5450432a2` |
| M01 G4 combine | PR [#41](https://github.com/dbn1972/serviceform-ai/pull/41) @ `436c3545cf31bc3a8ba9aaacfcb0b888a168bd90` |
| M01 exit token | **issued** (human Debabrata Nayak) family `M01` + `COMPLETE` + `G4_SECURITY` + `VERIFIED` via PR [#43](https://github.com/dbn1972/serviceform-ai/pull/43) |
| Frozen contracts | **13/13 MATCH** — do not change `contracts/**` or `orchestrator/contracts-lock.yaml` |
| CERTIFIED / RELEASE CERTIFIED / G6 | **false** |
| `planning_only` | **true** |
| `implementation_authorized` | **false** |
| Builders dispatched | **0** |
| M02 / M03 started | **false** |
| M01 Wave 3 feature work | **none** (not invented) |
| Self-certified | **false** |

Human Debabrata Nayak authorized **this planning pass only**. A later, separate human authorization is required before any envelope may leave `PLANNING` or be marked READY for implementation.

## 1. Governance sequence (normative)

1. Architecture Constitution (immutable constraints)
2. Frozen shared contracts (`orchestrator/contracts-lock.yaml`, 13/13 MATCH)
3. M01 G4 exit token issued (complete)
4. CG-01 concurrency gate plan + bounded M02/M03 envelopes (this document) — **PLANNING**
5. **Later, only if a human authorizes implementation:** isolated parallel builders inside write-path isolation
6. Serialized host mounts (`apps/api/**` single-writer windows)
7. Independent integration stitch per module (stitcher must not patch owner code)
8. Independent security verification per module (and INT-011 re-verify for new layers)
9. Independent evidence verification (recommend G3 only; **cannot CERTIFY**)
10. Human / CI gate for each module `G3_INTEGRATION` + `_` + `VERIFIED` (still **not** RELEASE CERTIFIED / G6)
11. M04 remains blocked until **both** M02 and M03 module exits exist

This planning pass stops at step 4.

## 2. Authoritative inputs

| Input | Role |
|---|---|
| `00_READ_FIRST.md`, `ARCHITECTURE-CONSTITUTION.md`, `AGENTS.md` | Absolute constraints |
| `MULTI-AGENT-DEVELOPMENT.md`, `CLAUDE-MULTI-AGENT-GUIDE.md` | Envelope / parallel rules |
| `specs/build-plan.yaml` (ADR-0001) | M02/M03 CMP+INT sets; CG-01; M04 depends on both |
| `specs/component-map.yaml`, Eng v1.4 §4 | Responsibilities (abridged in envelopes) |
| `specs/integration-map.yaml` | INT-001 (M02), INT-002 (M03); INT-011/013 cross-cutting owned by M01 |
| `specs/agent-topology.yaml`, `specs/agent-orchestration.yaml` | Roles, CG-01, merge policy |
| `MODEL-ROUTING-QUALITY.md` | Opus for identity/security/versioning/verifiers; Sonnet for bounded Studio/UX4G |
| `DESIGN-SYSTEM.md`, `specs/design-system.yaml` | UX4G 3.0 mandatory for first-party UI |
| M01 G4 exit | `docs/verification/M01-G4-EXIT.md`, `docs/verification/M01-G4-RESIDUALS.md`, `orchestrator/handovers/M01-G4-EXIT-GATE.yaml` |

Scheduling source of truth is ADR-0001 / `specs/build-plan.yaml`. Eng v1.4 §12 groupings are not used to re-home components (CMP-052 is **M03 only**).

## 3. Why CG-01 is open (planning)

M01 G4 exit preconditions recorded as satisfied for token issuance (not CERTIFIED):

- Wave 1 closed; Wave 2 closed; all 11 M01 CMPs on `main`
- V1–V5 style G4 gates PASS on the combine tip
- `CROSS_TENANT_LEAKAGE=0`
- Frozen **13/13 MATCH**
- Exit token issued by human (not agent self-issue)

CG-01 therefore **may be planned**. CG-01 **must not** be executed until a later human implementation authorization.

## 4. Topology (M02 ∥ M03)

```text
        [M01 G4 exit token issued — human]
                        |
        [THIS PASS: CG-01 PLANNING only]
                        |
        [later human implementation authorization — NOT granted]
                        |
        +---------------+----------------+
        |                                |
      M02                                M03
   CMP-004, CMP-005                 CMP-001, 033, 034,
   INT-001                          050, 051, 052, 053, 054
                                    INT-002
        |                                |
   services parallel                Wave A services ∥ UX4G
        |                                |
   SF-M02-003 HOST                 Wave B maker-checker+versioning
   (serial vs M03 host)                 |
        |                          Wave C Studio portal
        |                                |
        |                          SF-M03-008 HOST
        |                          (serial vs M02 host)
        |                                |
   SF-M02-INT/SEC/EVD              SF-M03-INT/SEC/EVD
        |                                |
        +---------------+----------------+
                        |
              M04 still blocked until both
              module G3 recommendations exist
```

**Recommended coding-agent cap after a later authorization:** 5–8 concurrent builders (topology), mixing M02 and M03 Wave A, then verifiers. Do not start 10–15 until path locks and CI are proven on this pair.

### 4.1 Parallelizable (after later implementation auth)

| Lane | Envelopes | Notes |
|---|---|---|
| M02 services | SF-M02-001, SF-M02-002 | Parallel via frozen request-context + ports; no sibling SQL |
| M03 Wave A | SF-M03-001, 002, 003, 005, 006 | Catalogue, metadata, master data, localization, UX4G |
| Evidence dirs | per-task `evidence/SF-M0x-00n/**` | Unique paths |

### 4.2 Serial / CG-01 constraints (cannot overlap writers)

| Constraint | Why | Rule |
|---|---|---|
| `apps/api/**` | Single Fastify host; `app.ts` shared | SF-M02-003 and SF-M03-008 **never concurrent**; orchestrator serializes |
| `pnpm-lock.yaml` | W1 lockfile policy | Orchestrator/stitch regen only |
| `packages/ui-ux4g/**` | Sole UI primitive home | SF-M03-006 only |
| `apps/web-studio/**`, `apps/web-admin/**` | Studio + tenant admin | SF-M03-007 only (after 002/004/006) |
| `apps/web-citizen/**`, `apps/web-officer/**` | Identity/profile surfaces | Not assigned to M03; M02 may add **AppShell-only** routes in a later authorized slice — not in Wave A services |
| Published versions | Constitution | CMP-051/052 must not mutate published artifacts |
| Frozen shared contracts | 13/13 | CCR required; stop if needed |
| Security/evidence | Independent | Builders cannot self-verify; stitcher cannot patch production code |

### 4.3 Cross-module peer edges (ports + FROZEN contracts, not unmerged branches)

| Consumer | Provider | Handling |
|---|---|---|
| CMP-004 | CMP-048, CMP-005, CMP-012 | 048 on main; 005 peer via ports; 012 M07 via INT-013 **SIMULATED** adapter |
| CMP-005 | CMP-004, CMP-030, CMP-012, CMP-007 | 030 on main; 004 peer via ports; 012 SIMULATED; 007 M08 not required |
| CMP-001 | CMP-002, CMP-003, CMP-051, CMP-052 | 002/003 on main; 051/052 same module via ports or after SF-M03-004 merge |
| CMP-034 | CMP-003, CMP-009, CMP-053 | 003 on main; 009 M04 peer later; 053 same module via ports |
| CMP-051 | CMP-033, CMP-043, CMP-052 | 043 M04 optional AI (must not block); 052 same envelope |
| First-party UI | CMP-054 | New primitives only via SF-M03-006; existing M00 `AppShell` may be consumed read-only |

## 5. Frozen contract list (all envelopes lock; no hash changes)

| Contract | Typical CG-01 consumers |
|---|---|
| SF-CON-COMMON | all |
| SF-CON-REQUEST-CONTEXT | all (identity produces verified principal later; do not fork schema) |
| SF-CON-AUTHZ-DECISION | M02, Studio/admin, host |
| SF-CON-ERROR-RESPONSE / SF-CON-ERROR-CATALOGUE | all |
| SF-CON-EVENT-ENVELOPE | all with outbox events |
| SF-CON-IDEMPOTENCY | identity, profile, catalogue, metadata, maker-checker |
| SF-CON-AUDIT-EVENT | all material changes |
| SF-CON-ISOLATION-DECLARATION | tenant-owned services |
| SF-CON-DB-SESSION-CONTEXT | all DB writers |
| SF-CON-OUTBOX | DB writers (byte-for-byte template; ADR-0006 #9 residual carried) |
| SF-CON-CONNECTOR-BINDING | INT-001 DigiLocker SIMULATED; identity/profile connector ports |
| SF-CON-SIMULATION-MARKER | INT-013 on SIMULATED DigiLocker/OTP/IdP adapters |

Component-local OpenAPI/JSON Schema under each service `contracts/` is allowed **without** editing `contracts/shared/**`. Promoting identity/profile/catalogue schemas into the shared freeze requires a **CCR**.

## 6. INT dependencies

| INT | Owner | CG-01 use |
|---|---|---|
| INT-001 | M02 | Citizen auth → profile → DigiLocker/consent (SIMULATED DigiLocker; consent via CMP-030 ports) |
| INT-002 | M03 | Studio → validation → maker-checker → publication (immutable published versions; applications pin TenantServiceBinding) |
| INT-011 | M01 (cross-cutting) | Re-verify for every new tenant-owned table / edge added by M02/M03 |
| INT-013 | M01 (cross-cutting) | SIMULATED OTP/IdP/DigiLocker adapters; fail-closed if production would silently SIMULATE a critical connector (production gate, not this plan) |

No INT-003…010 work. No DigiLocker REAL connector (CMP-012 is M07).

## 7. Evidence and security independence

| Gate | Owner | Writes | Cannot |
|---|---|---|---|
| Integration | `serviceform-integration-stitcher` (opus, high) | `tests/integration/**`, `evidence/integration/**`, module INT handover | Patch owner production code; self-certify |
| Security | `serviceform-security-verifier` (opus, xhigh) | `tests/security/**`, `evidence/security/**`, module SEC handover | Waive findings; start builders |
| Evidence | `serviceform-evidence-verifier` (opus, high) | `evidence/**` index/bind, `docs/verification/M02-*` / `M03-*` when authorized | Certify release |

Hard gates that will apply at later G3 (planning reminder; not claimed here): frozen 13/13; `CROSS_TENANT_LEAKAGE=0`; RLS negatives on new tenant tables; OPA deny for identity/admin; no PII/secrets in logs; no published-version mutation.

Builders **cannot** self-certify. This planning document **cannot** mark G3.

## 8. Residual carry-forward (from M01 G4)

| ID | Status at G4 token | CG-01 planning action |
|---|---|---|
| ADR-0006 #9 / R-OUTBOX-SF-APP | ACCEPTED_RESIDUAL | Carry; copy outbox template byte-for-byte; **no CCR** in this plan |
| R-BRANCH-PROT | ACCEPTED_RESIDUAL (OPS) | Carry; optional ops hygiene before **implementation** start; do not invent GitHub protection in-repo |
| R-ENV-INT | CLOSED_IN_CODE (on tip via #41) | Closed for planning; do not reopen as M01 Wave 3 |
| R-NOT-CERTIFIED | standing | Carry; no CERTIFIED claims |
| R-DPDP | CARRIED | No statutory invention; stop + ADR if policy interpretation demanded |
| R-INFRA | CARRIED | No REAL Keycloak/SMS/S3/KMS/WAF in this plan; SIMULATED/local |
| R-COV, R-RUNTIME, R-CMP055-PKG, R-HYGIENE-RATELIMIT, R-BUILDER-JUNIT | CARRIED | Unchanged |

## 9. M02 PLANNING envelopes (not READY)

Module exit (later): `G3_INTEGRATION` + `_` + `VERIFIED`. Components: CMP-004, CMP-005. Owned INT: INT-001.

| Task ID | CMP | Role / agent | Model | Parallel group | Serial after |
|---|---|---|---|---|---|
| SF-M02-001 | CMP-004 Identity & Access | foundation builder | opus 5.5 high | M02-A | M01 on main |
| SF-M02-002 | CMP-005 Citizen Profile | foundation builder | opus 5.5 high | M02-A | M01 on main (ports to 004) |
| SF-M02-003 | Host mount identity/profile plugins | foundation builder | opus 5.5 high | M02-HOST | 001+002 merges; **not concurrent with SF-M03-008** |
| SF-M02-INT | INT-001 + INT-011 layers | integration stitcher | opus high | M02-VERIFY | host + services |
| SF-M02-SEC | tenant/authz/PII | security verifier | opus xhigh | M02-VERIFY | after INT or parallel with INT if paths disjoint (`tests/security` vs `tests/integration`) |
| SF-M02-EVD | evidence bind | evidence verifier | opus high | M02-VERIFY | after INT+SEC |

`base_commit` for every M02 envelope = `cc49843eb70246842f5ea3c1c16257a5450432a2` (prefix `cc49843e` + suffix `b70246842f5ea3c1c16257a5450432a2`).

Requirement anchors (planning; no statute): Eng v1.4 CMP-004/005; Constitution #6/#7/#11/#21/#24/#28; ADR-0006 `sf_cmp004_rw` / `sf_cmp005_rw`; INT-001; INT-011/013.

**Non-goals:** CMP-012 implementation; REAL Keycloak/SMS; officer statutory roles as policy content; LLM authz decisions.

## 10. M03 PLANNING envelopes (not READY)

Module exit (later): `G3_INTEGRATION` + `_` + `VERIFIED`. Components: CMP-001, 033, 034, 050, 051, 052, 053, 054. Owned INT: INT-002. Cross-cutting: UX4G 3.0 baseline.

| Task ID | CMP(s) | Role / agent | Model | Parallel group | Serial after |
|---|---|---|---|---|---|
| SF-M03-001 | CMP-001 Catalogue | studio builder | sonnet 5.5 high | M03-A | M01 |
| SF-M03-002 | CMP-033 Metadata / Config | studio builder | sonnet 5.5 high | M03-A | M01 |
| SF-M03-003 | CMP-034 Master Data | studio builder | sonnet 5.5 high | M03-A | M01 (ports to 053/009) |
| SF-M03-004 | CMP-051 Maker-Checker + CMP-052 Versioning | studio builder | **opus** 5.5 high | M03-B | SF-M03-002 (metadata) preferred; 051/052 same writer |
| SF-M03-005 | CMP-053 Localization | studio builder | sonnet 5.5 medium | M03-A | M01 |
| SF-M03-006 | CMP-054 UX4G foundation | ux4g_agent | sonnet 5.5 high | M03-A | M01; exclusive `packages/ui-ux4g` |
| SF-M03-007 | CMP-050 Studio + admin portal | studio builder | sonnet 5.5 high | M03-C | 002, 004, 006 |
| SF-M03-008 | Host mount M03 plugins | foundation builder | opus 5.5 high | M03-HOST | M03 services; **not concurrent with SF-M02-003** |
| SF-M03-INT | INT-002 + INT-011 layers | integration stitcher | opus high | M03-VERIFY | after host |
| SF-M03-SEC | tenant/admin/publish authz | security verifier | opus xhigh | M03-VERIFY | disjoint from INT writes |
| SF-M03-EVD | evidence bind | evidence verifier | opus high | M03-VERIFY | after INT+SEC |

`base_commit` = same `origin/main` tip as §9.

Requirement anchors: Eng v1.4 listed CMPs; Constitution published-version immutability / TenantServiceBinding pin; UX4G 3.0; ADR-0006 `sf_cmp001_rw`, `sf_cmp033_rw`, `sf_cmp034_rw`, `sf_cmp051_rw`, `sf_cmp052_rw`, `sf_cmp053_rw` (054 is package-first; no tenant SQL unless an isolation declaration is added).

**Non-goals:** JSON Forms as a visual system; second design system; mutating published versions; GoRules statutory content; M04 forms/rules engines.

## 11. Non-overlapping write paths (planning freeze)

| Envelope | Allowed write paths |
|---|---|
| SF-M02-001 | `services/cmp-004-identity-access/**`, `db/migrations/*_cmp-004-*.sql` |
| SF-M02-002 | `services/cmp-005-citizen-profile/**`, `db/migrations/*_cmp-005-*.sql` |
| SF-M02-003 | `apps/api/src/composition/m02.ts` (create), `apps/api/src/app.ts` (mount call only), `apps/api/test/**` (m02 composition tests), `evidence/SF-M02-003/**`, `orchestrator/handovers/SF-M02-003.yaml` |
| SF-M02-INT | `tests/integration/m02/**`, `evidence/integration/m02/**`, `evidence/SF-M02-INT/**`, `orchestrator/handovers/SF-M02-INT.yaml` |
| SF-M02-SEC | `tests/security/m02/**`, `evidence/security/m02/**`, `evidence/SF-M02-SEC/**`, `orchestrator/handovers/SF-M02-SEC.yaml` |
| SF-M02-EVD | `evidence/**` (index/bind), `docs/verification/M02-*`, `orchestrator/handovers/SF-M02-EVD.yaml`, `orchestrator/handovers/M02-GATE.yaml` (later) |
| SF-M03-001 | `services/cmp-001-catalogue/**`, `db/migrations/*_cmp-001-*.sql` |
| SF-M03-002 | `services/cmp-033-metadata/**`, `db/migrations/*_cmp-033-*.sql` |
| SF-M03-003 | `services/cmp-034-master-data/**`, `db/migrations/*_cmp-034-*.sql` |
| SF-M03-004 | `services/cmp-051-maker-checker/**`, `services/cmp-052-versioning/**`, `db/migrations/*_cmp-051-*.sql`, `db/migrations/*_cmp-052-*.sql` |
| SF-M03-005 | `services/cmp-053-localization/**`, `db/migrations/*_cmp-053-*.sql` |
| SF-M03-006 | `packages/ui-ux4g/**`, `apps/mobile/lib/ux4g/**`, `services/cmp-054-ux4g/**` (if a service package is required; no product Studio pages) |
| SF-M03-007 | `apps/web-studio/**`, `apps/web-admin/**`, `services/cmp-050-studio-portal/**` |
| SF-M03-008 | `apps/api/src/composition/m03.ts` (create), `apps/api/src/app.ts` (mount call only), `apps/api/test/**` (m03 composition tests), `evidence/SF-M03-008/**`, `orchestrator/handovers/SF-M03-008.yaml` |
| SF-M03-INT | `tests/integration/m03/**`, `evidence/integration/m03/**`, `evidence/SF-M03-INT/**`, `orchestrator/handovers/SF-M03-INT.yaml` |
| SF-M03-SEC | `tests/security/m03/**`, `evidence/security/m03/**`, `evidence/SF-M03-SEC/**`, `orchestrator/handovers/SF-M03-SEC.yaml` |
| SF-M03-EVD | `evidence/**` (index/bind), `docs/verification/M03-*`, `orchestrator/handovers/SF-M03-EVD.yaml`, `orchestrator/handovers/M03-GATE.yaml` (later) |

**Forbidden for all CG-01 builders:** `contracts/**`, `orchestrator/contracts-lock.yaml`, sibling M01 `services/cmp-002|003|030|031|032|036|037|038|047|048|055-*/**` (consume via packages/ports), `infra/**` new cloud, cross-component SQL, CERTIFIED claims.

Path uniqueness must be re-checked with `python scripts/gates/check_scope.py` before any later dispatch. SF-M02-003 and SF-M03-008 share `apps/api/src/app.ts` — **time-isolated**, not concurrent.

## 12. Traceability to build-plan milestones

| Milestone | This plan |
|---|---|
| M00 | Already exited G1; not reopened |
| M01 | Exited G4 token (human); no Wave 3 features |
| **CG-01** | This document — planning only |
| **M02** | Envelopes SF-M02-*; exit G3 later |
| **M03** | Envelopes SF-M03-*; exit G3 later |
| M04 | **Blocked** until M02 and M03 exits |
| M10 G6 / CERTIFIED | **Out of scope** |

## 13. Blockers / CCR / ADR inventory

| ID | Item | Blocks planning? | Action |
|---|---|---|---|
| AUTH-IMPL | Human implementation authorization | N/A (planning done) | **Yes** for builders; remain `implementation_authorized: false` |
| CCR-SHARED-ID | Promote identity/profile schemas to shared freeze | No | Component-local first |
| ADR-IDP-INFRA | REAL Keycloak / SMS / DigiLocker | No | SIMULATED/local; ADR when REAL required |
| ADR-DPDP | Statutory privacy/eligibility text | No | Stop + ADR if interpretation required |
| R-BRANCH-PROT | `main` unprotected from API view | No | OPS residual; optional before impl start |
| CCR-OUTBOX | Tighten SF-CON-OUTBOX grants | No | Carry ACCEPTED_RESIDUAL |

**No blocking CCR/ADR is required to accept this plan.** Status remains `CG01_M02_M03_PLAN` + `PLANNING`, not READY, not BLOCKED.

If a later builder would need to change a frozen contract, tenant isolation model, or statutory meaning: **STOP** and file CCR/ADR. Do not invent policy.

## 14. Explicit non-goals

- No M02/M03 implementation, migrations, or package feature code in this PR
- No builder dispatch / worktrees / CLAIMED states
- No envelope state READY / IMPLEMENTATION_READY
- No frozen contract edits
- No M01 Wave 3 feature work
- No CERTIFIED / RELEASE CERTIFIED / G6 claim
- No published-version flips
- No statutory eligibility/approval logic

## 15. Envelope index

| File | State |
|---|---|
| `orchestrator/handovers/CG-01-PLAN.yaml` | PLANNING index |
| `orchestrator/handovers/M02-PLAN.yaml` | PLANNING index |
| `orchestrator/handovers/M03-PLAN.yaml` | PLANNING index |
| `orchestrator/handovers/SF-M02-001.yaml` … `003.yaml`, `SF-M02-INT.yaml`, `SF-M02-SEC.yaml`, `SF-M02-EVD.yaml` | PLANNING |
| `orchestrator/handovers/SF-M03-001.yaml` … `008.yaml`, `SF-M03-INT.yaml`, `SF-M03-SEC.yaml`, `SF-M03-EVD.yaml` | PLANNING |

At a **later** implementation authorization, copy/promote envelopes into `orchestrator/tasks/` with `state: READY`, refresh `base_commit` to that authorized `main` tip, run scope checks, then dispatch. Until then: **not dispatched**.

## 16. Confirmation

- Planning only: **yes**
- Implementation authorized: **no**
- Implementation started / builders started: **no**
- Frozen contracts altered: **no**
- CERTIFIED claimed: **no**
- M01 Wave 3 invented: **no**
- Statute interpreted: **no**
