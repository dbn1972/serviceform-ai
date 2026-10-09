# CG-02 plan: M06 ∥ M08 after M05 G4 exit (PLANNING ONLY)

**Decision token (split against CKV_SECRET_6):** family `CG02_M06_M08_PLANNING` + status `PLANNING` (do **not** join).  
**Envelope state:** `PLANNING`. **Not READY.** **Not dispatched.** Not CERTIFIED. Not RELEASE CERTIFIED. Not G6. **Implementation OFF.** **Builders OFF.** **M07+ OFF.**

| Field | Value |
|---|---|
| Concurrency group | CG-02 (`specs/build-plan.yaml`, `specs/agent-orchestration.yaml`) |
| After | M05 exit gate `G4_SECURITY` + `_` + `VERIFIED` + post-merge finalization on main (`88690846…` / #111) |
| Parallel modules | M06 Fees/Payments/Notifications/Messaging **∥** M08 Search/Discovery/Recommendation/Analytics/Ops/Retention |
| Planning baseline | prefix `88690846` + suffix `021a2ce082b8a7c7f35c12603effd5d9` |
| M05 G4 combine / finalize | PR [#111](https://github.com/dbn1972/serviceform-ai/pull/111) merge `88690846021a2ce082b8a7c7f35c12603effd5d9` |
| M05 exit token | **issued** (human) family `M05` + `G4_SECURITY` + `VERIFIED`; `OPERATIONAL_FINALIZATION_REQUIRED=false` |
| Evidence PRs (immutable / unmerged) | #107 `59ddddd4…`, #108 `d1614d70…`, #109 `8b270beb…` |
| Frozen contracts | **19/19 MATCH** — do not change existing hashes or silently edit `contracts/shared/**` / prior M05 rows |
| `CG_02_CONTRACT_FREEZE_REQUIRED` | **true** (NEW M06/M08 contracts proposed; freeze needs separate human auth; **not this PR**) |
| `STATUTORY_RETENTION_POLICY_INPUT_REQUIRED` | **true** (CMP-049; do not invent retention periods) |
| CERTIFIED / RELEASE CERTIFIED / G6 | **false** |
| `planning_only` | **true** |
| `implementation_authorized` | **false** |
| Builders dispatched | **0** |
| M07 / M09–M12 | **OFF** |

Human authorization for **this planning package only** (`CG_02_M06_M08_PLANNING_AUTHORIZED`). READY promotion, builder dispatch, contract freeze, and product code are **not** authorized. Do not invent an M08→M06 dependency; peers via FROZEN contract/port or planning blocker only.

Machine-readable index: `orchestrator/handovers/CG-02-PLAN.yaml`. Module indexes: `M06-PLAN.yaml`, `M08-PLAN.yaml`. Envelope table: `docs/planning/CG-02-M06-M08-ENVELOPES.md`. Contract catalog: `docs/planning/CG-02-M06-M08-CONTRACT-PREREQUISITES.md`.

## 1. Governance sequence (normative)

1. Architecture Constitution (immutable constraints)
2. Frozen shared + M05 contracts (**19/19 MATCH**)
3. M05 G4 exit + post-merge finalization on `main` (#111; green CI/security/developer-platform)
4. **This pass:** bounded M06/M08 envelopes PLANNING; builders OFF; **no freeze**; **no READY**
5. LOCK-1: planning PR merged (human/CI later); uniqueness/contracts/architecture green; still no builders
6. LOCK-2: **SF-M06-CG-001** and **SF-M08-CG-001** (mandatory, separate human freeze auth) identify and later freeze **NEW** M06/M08 contracts only — after planning merge, **before Wave A**. Status now: `PROPOSED` / `CONTRACT-GUARDIAN-REVIEW-REQUIRED`. `freeze_authorized: false`. Existing 19 rows READ-ONLY / immutable hashes. **Not this PR.**
7. LOCK-3: Wave A parallel builders per module (after freeze on `origin/main` + dispatch record)
8. LOCK-4: STITCH-A mechanical/format/lockfile on Wave A trees + migrations after immutable heads
9. LOCK-5: Wave B / sequenced components after STITCH-A on `origin/main`
10. LOCK-6: STITCH-B Wave B trees + lockfile
11. LOCK-7: Module host mounts — **hard serial across CG-02**: SF-M06-005 never concurrent with SF-M08-007 (`apps/api/**` / `app.ts` single-writer)
12. LOCK-8: INT ∥ SEC per module (owned INTs + INT-011/013 re-verify); SEC independent
13. LOCK-9: EVD recommend G3 only → human/CI may later issue module `G3_INTEGRATION_VERIFIED` (still **not** CERTIFIED / G6)
14. M07 remains OFF until M06 G3; M09–M12 remain OFF per build-plan

This planning pass completes step 4 only.

## 2. Authoritative inputs

| Input | Role |
|---|---|
| `00_READ_FIRST.md`, `ARCHITECTURE-CONSTITUTION.md`, `AGENTS.md` | Absolute constraints |
| `MULTI-AGENT-DEVELOPMENT.md`, `CLAUDE-MULTI-AGENT-GUIDE.md` | Envelope / parallel rules |
| `specs/build-plan.yaml` (ADR-0001) | M06/M08 CMP+INT sets; CG-02; M07 depends on M06; M09/M10 depend on M07+M08 |
| `specs/component-map.yaml`, Eng v1.4 §4 | Responsibilities (abridged in envelopes) |
| `specs/integration-map.yaml` | INT-007 (M06); INT-003, INT-010 (M08); INT-011/013 cross-cutting owned by M01 |
| `specs/agent-topology.yaml`, `specs/agent-orchestration.yaml` | Roles, CG-02, merge policy |
| `MODEL-ROUTING-QUALITY.md` | Opus for payment money-movement / retention-privacy / security verifiers; Sonnet for bounded adapters when hard gates clear |
| `AI-GOVERNANCE.md` | CMP-007 and any model calls only via CMP-039 (already on main from M04); non-authoritative |
| M05 G4 + finalize | `orchestrator/handovers/SF-M05-GATE.yaml` on tip `88690846…` |

Scheduling source of truth is ADR-0001 / `specs/build-plan.yaml`. Eng v1.4 §12 groupings must not re-home components.

## 3. Why CG-02 is PLANNING (not READY)

M05 G4 preconditions for **planning** are satisfied on exact main `88690846021a2ce082b8a7c7f35c12603effd5d9`:

- M05 G4 issued and post-merge finalized (#111)
- `OPERATIONAL_FINALIZATION_REQUIRED=false`
- Frozen **19/19 MATCH**
- Evidence PRs #107/#108/#109 remain DRAFT unmerged at bound heads (immutable)

CG-02 is **planning-authorized only**. Envelopes are **not** READY. Builders are **not** started. Contract freeze is **not** authorized in this slice.

## 4. Topology (M06 ∥ M08)

```text
        [M05 G4 + finalize on main 88690846…]
                        |
        [THIS PASS: CG-02 PLANNING; builders OFF; no freeze; no READY]
                        |
        +---------------+----------------+
        |                                |
      M06                                M08
   CMP-020,021,025,026              CMP-006,007,035,
   INT-007                          045,046,049
                                    INT-003, INT-010
        |                                |
   CG-001 NEW contracts             CG-001 NEW contracts
   (later freeze auth)              (later freeze auth)
        |                                |
   Wave A: 020∥025∥026              Wave A: 035∥007∥045∥046∥049
        |                                |
   STITCH-A                         STITCH-A
        |                                |
   Wave B: 021 Payment              Wave B: 006 Discovery
        |                                |
   STITCH-B                         STITCH-B
        |                                |
   SF-M06-005 HOST  <=== SERIAL ===>  SF-M08-007 HOST
   (apps/api single-writer windows; never concurrent)
        |                                |
   INT∥SEC → EVD (G3 rec)           INT∥SEC → EVD (G3 rec)
        |                                |
        +---------------+----------------+
                        |
         M07 still blocked until M06 G3
         M09/M10 still blocked until M07+M08 G3
```

**Peers:** M06 and M08 are independent after M05. Do **not** invent M08→M06 dependency. Genuine shared needs use FROZEN contracts/ports already on main (e.g. CMP-038 event bus, CMP-037 integration hub, CMP-039 AI gateway) or a planning blocker + CCR.

**Recommended coding-agent cap after a later authorization:** 5–8 concurrent builders mixing M06 and M08 Wave A, then verifiers. Do not start 10–15 until path locks and CI are proven.

### 4.1 M06 parallelizable (Wave A — later, after freeze)

| Lane | Envelopes | Notes |
|---|---|---|
| Fee | SF-M06-001 (CMP-020) | Deterministic fee calculation; no invented fee policy |
| Notification | SF-M06-002 (CMP-025) | Template/channel ports; INT-013 modes |
| Messaging | SF-M06-003 (CMP-026) | Conversation/thread; attachment refs via storage ports |
| Evidence dirs | `evidence/SF-M06-00n/**` | Unique paths |

### 4.2 M06 sequenced (Wave B — later)

| Lane | Envelope | Why wait |
|---|---|---|
| Payment | SF-M06-004 (CMP-021) | INT-007 fee → payment → verified callback; consume Fee via FROZEN/port after Wave A on main |

### 4.3 M08 parallelizable (Wave A — later, after freeze)

| Lane | Envelopes | Notes |
|---|---|---|
| Search | SF-M08-001 (CMP-035) | Index pipelines; tenant-safe filters |
| Recommendation | SF-M08-002 (CMP-007) | Non-authoritative; **only via CMP-039** on main |
| Analytics | SF-M08-003 (CMP-045) | KPI/MIS; consume events via ports |
| Ops dashboard | SF-M08-004 (CMP-046) | Health/queue/SLA views; no case authority |
| Retention | SF-M08-005 (CMP-049) | Policy engine only; **no invented statutory periods** |

### 4.4 M08 sequenced (Wave B — later)

| Lane | Envelope | Why wait |
|---|---|---|
| Discovery | SF-M08-006 (CMP-006) | Consumes Search (035) + catalogue on main via ports |

### 4.5 Serial / CG-02 constraints (cannot overlap writers)

| Constraint | Why | Rule |
|---|---|---|
| `apps/api/**` | Single Fastify host; `app.ts` shared | SF-M06-005 and SF-M08-007 **never concurrent**; orchestrator serializes |
| `pnpm-lock.yaml` | Lockfile policy | STITCH-A/B / orchestrator only — never builders |
| Existing `contracts/**` hashes | 19/19 FROZEN | CCR+STOP if existing row must change |
| NEW `contracts/m06/**`, `contracts/m08/**` | Module contracts | Freeze only via CG-001 after separate human auth |
| Migration namespaces | Disjoint globs | `*_cmp-020-*` … `*_cmp-049-*` single-writer |
| Security/evidence | Independent | Builders cannot self-verify; stitcher cannot patch production code |
| M05 evidence PRs | Immutable | Do not modify/merge #107/#108/#109 |

### 4.6 Cross-module peer edges (ports + FROZEN contracts, not unmerged branches)

| Consumer | Provider | Handling |
|---|---|---|
| CMP-021 | CMP-015/016 (M05), CMP-020, CMP-037 | 015/016/037 on main; 020 peer via ports after Wave A |
| CMP-020 | CMP-008, CMP-051 | on main; waiver/exemption via metadata — **no invented fee statute** |
| CMP-025 | CMP-037/038/053 | on main; provider adapters INT-013 |
| CMP-026 | CMP-004/013/015/031 | on main via ports |
| CMP-007 | CMP-001/005/030/039 | on main; AI only through CMP-039; non-authoritative |
| CMP-006 | CMP-001/003/035/053 | 001/003/053 on main; 035 same module after Wave A |
| CMP-035 | CMP-001/015/038 | on main |
| CMP-045/046 | CMP-038/037/029/047 | on main |
| CMP-049 | CMP-015/030/031/032 | on main; retention periods require owner input |

## 5. Frozen contract list (consume as-is; no hash changes)

All envelopes lock the current **19** FROZEN contracts. Do not edit them in this PR.

Component-local OpenAPI/JSON Schema under each future service `contracts/` is allowed **without** editing frozen paths. Promoting fee/payment/notification/search/retention schemas into a shared or module freeze requires **SF-M06-CG-001 / SF-M08-CG-001** + human freeze authorization (separate).

See `docs/planning/CG-02-M06-M08-CONTRACT-PREREQUISITES.md`.

## 6. INT dependencies

| INT | Owner | CG-02 use |
|---|---|---|
| INT-007 | M06 | Fee → payment → verified callback → application/workflow (idempotent; zero duplicate financial side effects) |
| INT-003 | M08 | Discovery/recommendation → form/application draft (recommendation non-authoritative) |
| INT-010 | M08 | Events → OpenSearch → analytics → dashboards (tenant-safe) |
| INT-011 | M01 (cross-cutting) | Re-verify for every new tenant-owned table / edge added by M06/M08 |
| INT-013 | M01 (cross-cutting) | REAL/SANDBOX/SIMULATED for payment/notification/messaging providers; fail-closed if production would silently SIMULATE a critical connector |

No INT-008 (M07). No DigiLocker REAL connector. No invented payment provider or fee schedule.

## 7. External dependency discipline (M06)

| Component | Discipline |
|---|---|
| CMP-021 Payment | Adapter SPI via CMP-037; modes REAL/SANDBOX/SIMULATED per INT-013; webhook verification; idempotent callbacks; **no invented PSP policy** |
| CMP-025 Notification | Channel adapters (SMS/email/push) via INT-013; templates metadata-driven; **no hard-coded provider secrets** |
| CMP-026 Messaging | Attachment refs via CMP-032 ports; no direct object-store credentials in service |
| Production gate (later) | Critical connectors must not ship SIMULATED silently |

## 8. AI boundary (M08)

- CMP-007 Recommendation **must** call models only through **CMP-039** (already on `main` from M04).
- Recommendations are **decision support only** — never final statutory eligibility, approval, rejection, fee waiver grant, or payment disposition.
- CMP-045/046 analytics and ops views must not become an authoritative case/payment store.

## 9. Retention (CMP-049)

- Implement retention **policy machinery** and archive/delete eligibility transitions only.
- Do **not** invent statutory retention periods, DPDP erasure timelines, or jurisdiction-specific schedules.
- Flag: `STATUTORY_RETENTION_POLICY_INPUT_REQUIRED=true` until owner supplies approved policy inputs (separate from this planning PR).

## 10. Evidence and security independence

| Gate | Owner | Writes (later) | Cannot |
|---|---|---|---|
| Integration | `serviceform-integration-stitcher` (opus, high) | `tests/integration/m06/**` or `m08/**`, evidence, INT handover | Patch owner production code; self-certify |
| Security | `serviceform-security-verifier` (opus, xhigh) | `tests/security/m06/**` or `m08/**`, evidence, SEC handover | Waive findings; start builders |
| Evidence | `serviceform-evidence-verifier` (opus, high) | evidence index/bind, G3 recommendation docs when authorized | Certify release; issue G3 |

Hard gates that will apply at later G3 (planning reminder; not claimed here): frozen 19/19 (+ any NEW frozen rows); `CROSS_TENANT_LEAKAGE=0`; RLS negatives on new tenant tables; OPA deny; no PII/secrets in logs; zero duplicate financial side effects (M06); no published-version mutation; production fail-closed on critical SIMULATED.

Builders **cannot** self-certify. This planning document **cannot** mark G3.

## 11. Residual carry-forward

| ID | Status | CG-02 planning action |
|---|---|---|
| ADR-0006 #9 / R-OUTBOX-SF-APP | ACCEPTED_RESIDUAL | Carry; copy outbox template byte-for-byte; **no CCR** in this plan |
| R-NOT-CERTIFIED | standing | Carry; no CERTIFIED claims |
| R-DPDP | CARRIED | No statutory invention; CMP-049 waits on owner retention input |
| R-INFRA | CARRIED | No REAL PSP/SMS/email/OpenSearch in this planning slice; SIMULATED/local later under INT-013 |
| M05 #107/#108/#109 | DRAFT_UNMERGED | Immutable; do not merge or modify |
| CMP-028 appeal residual | GOVERNING_UNRESOLVED_UNWAIVED (M05) | Non-blocking carried; do not reopen in CG-02 planning |

## 12. Non-goals (this slice)

- No product code (`services/**`, `apps/**`, `packages/**`, `db/migrations/**`, `contracts/**`, `pnpm-lock.yaml`)
- No `orchestrator/tasks/**`
- No Wave A/B/host/INT/SEC/EVD dispatch
- No contract freeze; no edit of `orchestrator/contracts-lock.yaml`
- No READY promotion
- No merge of this PR by the planning agent
- No modification/merge of #107/#108/#109
- No M07+ envelopes or activation
- No CERTIFIED / G6 claim
- No invented fee/payment/provider/retention statute

## 13. Acceptance for planning candidate

Planning candidate is ready when:

1. Pre-start guard still holds (`origin/main` exact tip; #111 merged; #107–109 unmerged at bound heads)
2. One DRAFT PR from branch `cursor/cg02-m06-m08-plan-88690846` contains only allowed planning/control-plane paths
3. All M06/M08 implementation envelopes: `state: PLANNING`, `orchestration_task_state: PLANNING`, `planning_only: true`, `implementation_authorized: false`, `dispatched: false`, `builders_dispatched_this_envelope: false`, certification flags false
4. Exact-head CI + Security + Developer-platform SUCCESS
5. Contracts remain **19/19 MATCH** (unchanged by this PR)
6. `CG_02_CONTRACT_FREEZE_REQUIRED=true` recorded with proposal; freeze not performed
7. Next gate named: `INDEPENDENT_CG_02_PLANNING_REVIEW` / `HUMAN_CG_02_READY_PROMOTION_AUTHORIZATION`
