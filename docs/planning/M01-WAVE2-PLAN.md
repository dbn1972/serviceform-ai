# M01 Wave 2 plan (PLANNING ONLY)

**Decision token: `M01_WAVE2_PLAN_READY`**

| Field | Value |
|---|---|
| Module | M01 Foundation, Tenancy, Jurisdiction, Security and Platform Backbone |
| Planning baseline | `origin/main` @ `1c9a650abc439610badd21d927c7a53d27d3fd12` |
| Wave 1 closure | `M01_WAVE1_MERGED_AND_CLOSED` (merge `37cbf203e18d8e072353139e368356a8dac00946` is first-parent ancestry under tip) |
| Wave 1 verified | V1–V5 PASS; `CROSS_TENANT_LEAKAGE=0`; frozen contracts **13/13 MATCH** |
| CERTIFIED | **false** (not claimed; not in scope of this plan) |
| `wave_2_started` | **false** |
| `implementation_authorized` | **false** |
| Builders dispatched | **0** |
| Frozen contracts altered | **none** |
| Self-certified | **false** |

## 1. Governance sequence (normative)

1. Architecture Constitution (immutable constraints)
2. Frozen shared contracts (`orchestrator/contracts-lock.yaml`, 13/13 MATCH)
3. Dependency-aware Wave 2 scope (this document)
4. Bounded task envelopes (`orchestrator/handovers/SF-M01-W2-00x.yaml`) — **PLANNING** only
5. **Later, only if a human authorizes implementation:** isolated parallel builders
6. Independent integration stitch
7. Independent security verification
8. Independent evidence verification
9. Human / CI gate (still **not CERTIFIED** unless a separate certification gate says so)

This planning pass stops at step 4. No Wave 2 builder is claimed, branched for code, or PR’d for implementation.

## 2. Authoritative inputs

| Input | Role |
|---|---|
| `00_READ_FIRST.md`, `ARCHITECTURE-CONSTITUTION.md`, `AGENTS.md` | Absolute constraints |
| `MULTI-AGENT-DEVELOPMENT.md`, `CLAUDE-MULTI-AGENT-GUIDE.md` | Envelope / parallel rules |
| `specs/build-plan.yaml` (ADR-0001) | M01 component set and exit gate `G4_SECURITY_VERIFIED` |
| `specs/component-map.yaml`, Eng v1.4 §4 | Responsibilities, APIs, events, non-responsibilities |
| `specs/integration-map.yaml` | INT-011 (tenant isolation), INT-013 (simulation SPI) |
| `specs/agent-topology.yaml`, `specs/agent-orchestration.yaml` | Roles, write isolation, merge policy |
| `MODEL-ROUTING-QUALITY.md` / `specs/model-routing-quality.yaml` | Opus foundation / independent verifiers |
| `orchestrator/work-queue.yaml` `deferred_to_wave_2` | Prior W1 deferral inventory |
| `orchestrator/dispatch/DISPATCH-PLAN-M01-W1.md` §1 | W2 grouping rationale |
| Wave 1 closure | `docs/verification/M01-WAVE1-CLOSURE.md` + store `docs/m01-wave1-closure.md` |
| Wave 1 handovers | `orchestrator/handovers/SF-M01-001.yaml` … `005.yaml`, `M01-WAVE1-GATE.yaml` |

## 3. Wave 1 already on `main` (do not rebuild)

| Task | CMP | Scope on main |
|---|---|---|
| SF-M01-001 | CMP-002 Tenant & Government Organisation | Merged |
| SF-M01-002 | CMP-048 Security Platform | Merged |
| SF-M01-003 | CMP-031 Audit & Evidence Ledger | Merged |
| SF-M01-004 | CMP-038 Event Bus / Messaging | Merged |
| SF-M01-005 | CMP-037 Integration Hub / Connector Framework | Merged |

W1 residuals remain **non-blocking** for planning:

1. ADR-0006 condition 9 / SF-CON-OUTBOX: `GRANT INSERT` (and inbox `SELECT, INSERT`) **TO `sf_app`** is frozen-template behavior; tightening needs a **CCR** (not opened by this plan).
2. Module / release is **not CERTIFIED**.
3. Host composition (`apps/api` / CMP-036) was explicitly out of Wave 1 — it is in Wave 2 scope below.

## 4. Dependency-aware Wave 2 scope

M01 remaining components after Wave 1:

| Envelope | CMP(s) | Eng purpose (slice) | Hard deps (merged W1) | Peer / later deps (ports only) |
|---|---|---|---|---|
| SF-M01-W2-001 | CMP-003 Jurisdiction Engine | Versioned geo/admin jurisdiction; resolve scope | CMP-002 | CMP-004/008/017 via frozen contracts later |
| SF-M01-W2-002 | CMP-030 Consent & Privacy | Consent capture, purpose binding, withdraw, access-check | CMP-002, CMP-031, CMP-048 | CMP-004/005/049 via ports; no statutory invention |
| SF-M01-W2-003 | CMP-032 Storage Service | Object metadata, encryption policy, presigned access (SIMULATED/local first) | CMP-031, CMP-048 (secrets/KMS adapter ports) | CMP-013/049 later; no durable pod filesystem |
| SF-M01-W2-004 | CMP-036 API Gateway + CMP-047 Observability | Single-writer host mount + OTel/redaction platform slice | All W1 plugins on main | Mount W2 plugins after those merges (same writer) |
| SF-M01-W2-005 | CMP-055 Developer Platform | CI/gates/repo/dev tooling slice under controlled paths | M00 + W1 evidence patterns | Does not silently change architecture |

Cross-cutting INT ownership for M01 (build-plan):

- **INT-011** Tenant isolation chain — re-verified for every W2 layer that adds tenant-owned state or edge ingress.
- **INT-013** External dependency simulation — CMP-032 local/SIMULATED object store must honor simulation markers where applicable; CMP-037 SPI remains FROZEN.

Requirement / acceptance anchors (planning level; builders expand in plan-approval phase after implementation authorization):

- Constitution #2 (org hierarchy ≠ jurisdiction hierarchy), #6/#7/#11/#21/#24/#28/#34 as applicable.
- ADR-0006 Option A privilege roles `sf_cmp003_rw`, `sf_cmp030_rw`, `sf_cmp032_rw` (and gateway/obs packages without unauthorized cross-schema DML).
- Eng v1.4 interfaces cited in each envelope.
- Hard gates: frozen contract conformance 100%; `cross_tenant_leakage=0`; privilege-boundary 100%; RLS negatives where tenant-scoped tables exist.

## 5. Parallelization map

```text
                    [human authorizes Wave 2 implementation]
                                    |
        +------------+--------------+--------------+-------------+
        |            |              |              |             |
   W2-001         W2-002         W2-003        W2-005        W2-004*
   CMP-003        CMP-030        CMP-032       CMP-055       CMP-036+047
        |            |              |              |             |
        +-----+------+------+-------+------+-------+             |
              |             |              |                     |
              v             v              v                     v
         (merge candidates; lockfile reconcile by orchestrator)
                                    |
                         SF-M01-W2-INT  integration stitcher
                                    |
                         SF-M01-W2-SEC  security verifier
                                    |
                         SF-M01-W2-EVD  evidence verifier
                                    |
                         human / CI gate  (still not CERTIFIED)
```

\* **W2-004 sequencing note:** May start in parallel for **Wave-1 plugin registration + observability baseline**, because W1 services already exist on `main`. Registration of W2-001/002/003 plugins is a **follow-up commit by the same single writer** after those component merges (or a second PR by the same envelope). No other task may write `apps/api/**` or `packages/observability/**`.

**Recommended concurrency after implementation authorization:** up to 5 coding agents (topology 5–8), then independent verifiers only (builders must not self-verify).

## 6. Non-overlapping write paths

| Envelope | Allowed write paths (planning freeze) |
|---|---|
| SF-M01-W2-001 | `services/cmp-003-jurisdiction/**`, `db/migrations/*_cmp-003-*.sql` |
| SF-M01-W2-002 | `services/cmp-030-consent-privacy/**`, `db/migrations/*_cmp-030-*.sql` |
| SF-M01-W2-003 | `services/cmp-032-storage/**`, `packages/storage/**`, `db/migrations/*_cmp-032-*.sql` |
| SF-M01-W2-004 | `apps/api/**`, `packages/observability/**`, `services/cmp-036-api-gateway/**`, `services/cmp-047-observability/**` |
| SF-M01-W2-005 | `services/cmp-055-developer-platform/**`, `scripts/gates/**` (additive only; no weakening), `.github/workflows/**` (additive jobs only; no secret leak), `evidence/SF-M01-W2-005/**` at evidence time |
| SF-M01-W2-INT | `tests/integration/**`, `evidence/integration/**`, `orchestrator/handovers/SF-M01-W2-INT.yaml` |
| SF-M01-W2-SEC | `tests/security/**`, `evidence/security/**`, `orchestrator/handovers/SF-M01-W2-SEC.yaml` |
| SF-M01-W2-EVD | `evidence/**` (index/bind only), `docs/verification/M01-WAVE2-*`, `orchestrator/handovers/SF-M01-W2-EVD.yaml`, `orchestrator/handovers/M01-WAVE2-GATE.yaml` |

**Shared / forbidden for all builders:**

- `contracts/**`, `orchestrator/contracts-lock.yaml` — FROZEN; CCR required to change
- `pnpm-lock.yaml` — orchestrator/integration regen only (W1 lockfile policy)
- Sibling `services/cmp-002|031|037|038|048-*/**` — read-only consume via packages/frozen contracts
- `infra/**` — no new cloud infra without ADR (CMP-032 uses local/SIMULATED adapter)
- Cross-component SQL — DENY (ADR-0006)

Path uniqueness must be re-checked with `python scripts/gates/check_scope.py` before any builder dispatch.

## 7. Frozen contract dependencies

All Wave 2 envelopes lock the existing FROZEN set (no hash changes):

| Contract | W2 consumers (planning) |
|---|---|
| SF-CON-COMMON | all |
| SF-CON-REQUEST-CONTEXT | all |
| SF-CON-AUTHZ-DECISION | 001, 002, 003, 004 |
| SF-CON-ERROR-RESPONSE / SF-CON-ERROR-CATALOGUE | all |
| SF-CON-EVENT-ENVELOPE | 001, 002, 003 (+ platform events on 004/055 as applicable) |
| SF-CON-IDEMPOTENCY | 001, 002, 003 |
| SF-CON-AUDIT-EVENT | 001, 002, 003, 004 |
| SF-CON-ISOLATION-DECLARATION | 001, 002, 003 |
| SF-CON-DB-SESSION-CONTEXT | 001, 002, 003 |
| SF-CON-OUTBOX | 001, 002, 003 (byte-for-byte template) |
| SF-CON-CONNECTOR-BINDING / SF-CON-SIMULATION-MARKER | 003 (SIMULATED store), 004 as needed for edge simulation markers |

Component-local OpenAPI/AsyncAPI/JSON Schema under each service `contracts/` is allowed **without** editing `contracts/shared/**`. Promoting a storage/consent/jurisdiction schema into the shared frozen set requires a **CCR** before freeze.

## 8. Model routing (for later dispatch)

| Envelope | Role / agent | Model route | Effort |
|---|---|---|---|
| SF-M01-W2-001 | foundation builder | opus (`claude-opus-5-5`) | high |
| SF-M01-W2-002 | foundation builder | opus | high |
| SF-M01-W2-003 | foundation builder | opus | high |
| SF-M01-W2-004 | foundation builder | opus | high |
| SF-M01-W2-005 | foundation builder (delivery-controlled) | opus | high |
| SF-M01-W2-INT | integration stitcher | opus | high |
| SF-M01-W2-SEC | security verifier | opus | xhigh |
| SF-M01-W2-EVD | evidence verifier | opus | high |

Security-negative / deny tests for 001–004 are written by the security verifier **before** implementation once implementation is authorized (MODEL-ROUTING-QUALITY §9).

## 9. Post-builder independent gates

| Gate | Owner | Must prove |
|---|---|---|
| Integration (INT) | `serviceform-integration-stitcher` | W2 components compose with W1 via frozen contracts; host mounts; no cross-component SQL; INT-011/013 scenarios for new layers |
| Security | `serviceform-security-verifier` | `CROSS_TENANT_LEAKAGE=0`; RLS/OPA/privilege-boundary; edge tenant header forgery denied; no PII in logs |
| Evidence | `serviceform-evidence-verifier` | Traceability, executed junit/coverage/gates, commit SHA bind; recommend gate — **cannot CERTIFY** |
| Architecture (optional reconfirm) | contract guardian / architecture | Frozen hashes still 13/13; envelopes respected |

Builders **cannot** self-certify. Stitcher **cannot** patch owner production code to force green.

## 10. Blockers / CCR / ADR inventory

| ID | Item | Blocks Wave 2 planning? | Blocks later implementation? | Action |
|---|---|---|---|---|
| CCR-OUTBOX-GRANTS | Tighten SF-CON-OUTBOX `sf_app` grants (ADR-0006 #9 residual) | **No** | No (residual) | Optional CCR; not opened here |
| ADR-DPDP-ANCHORS | DPDP / statutory privacy content (Arch Verif M-09) | **No** | Only if builder would invent statute | CMP-030 implements **platform** consent/purpose machinery only; stop + ADR if statutory interpretation is required |
| ADR-STORAGE-INFRA | Production S3/KMS/WAF cloud resources | **No** | Yes for REAL prod storage/edge | W2 uses local/SIMULATED object store + existing CMP-048 secret/KMS **ports**; REAL infra needs separate ADR |
| CCR-SHARED-STORAGE | Promote storage object schema to shared freeze | **No** | Only if shared freeze demanded mid-build | Prefer component-local contracts first |
| AUTH-IMPL | Human authorization to start Wave 2 builders | N/A (planning done) | **Yes** | `implementation_authorized` must flip true in a human-approved record; until then `wave_2_started=false` |

**No blocking CCR/ADR is required to accept this plan.** Status remains `M01_WAVE2_PLAN_READY`, not `M01_WAVE2_PLAN_BLOCKED`.

## 11. Explicit non-goals of this planning pass

- No Wave 2 implementation code, migrations, or package changes
- No builder PRs / worktrees / agent registry CLAIMED states
- No frozen contract edits
- No CERTIFIED / VERIFIED release claim
- No M02+ module work
- No merge to `main` of anything except this planning documentation PR

## 12. Envelope index

| File | State |
|---|---|
| `orchestrator/handovers/M01-WAVE2-PLAN.yaml` | PLANNING index |
| `orchestrator/handovers/SF-M01-W2-001.yaml` | PLANNING |
| `orchestrator/handovers/SF-M01-W2-002.yaml` | PLANNING |
| `orchestrator/handovers/SF-M01-W2-003.yaml` | PLANNING |
| `orchestrator/handovers/SF-M01-W2-004.yaml` | PLANNING |
| `orchestrator/handovers/SF-M01-W2-005.yaml` | PLANNING |
| `orchestrator/handovers/SF-M01-W2-INT.yaml` | PLANNING (post-builder) |
| `orchestrator/handovers/SF-M01-W2-SEC.yaml` | PLANNING (post-builder) |
| `orchestrator/handovers/SF-M01-W2-EVD.yaml` | PLANNING (post-builder) |

At implementation authorization, promote/copy envelopes into `orchestrator/tasks/` with `state: READY`, set `base_commit` to the authorized `main` tip, run scope checks, then dispatch. Until then these remain **not dispatched**.

## 13. Confirmation

- Planning only: **yes**
- Implementation started: **no**
- Wave 2 builders started: **no** (`wave_2_started: false`)
- Frozen contracts altered: **no**
- CERTIFIED claimed: **no**

Store mirrors:

- `/cursor/stores/bc-1e78e82c-97d0-4244-ab49-3bcc7891e193/docs/m01-wave2-plan.md`
- `/cursor/stores/bc-1e78e82c-97d0-4244-ab49-3bcc7891e193/docs/m01-wave2-envelopes.md`
