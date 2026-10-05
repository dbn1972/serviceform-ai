# M05 plan: Application, Case, Workflow, Tasks, Verification, Deficiency, SLA, Grievance, Appeal (PLANNING)

**Decision token (split against CKV_SECRET_6):** family `M05_PLANNING` + status `PLANNING` (do **not** join).  
**Envelope state:** `PLANNING`. **Not dispatched.** Not CERTIFIED. Not RELEASE CERTIFIED. Not G6. **Implementation OFF.** **M06/M08 OFF.**

| Field | Value |
|---|---|
| Module | M05 |
| After | M04 `G3_INTEGRATION` + `_` + `VERIFIED` (human issued; recorded on `main` via #82) |
| Planning / post-merge base | prefix `b286ed95` + suffix `6755b936f73bc2856c9db2c68d8ca64c` |
| Post-merge CI | ci `37265198756` SUCCESS; security `37265198732` SUCCESS; developer-platform `37265198749` SUCCESS |
| Components (exactly 8, once) | CMP-015, CMP-016, CMP-017, CMP-018, CMP-019, CMP-027, CMP-028, CMP-029 |
| Owned numbered INT | INT-004, INT-005, INT-006, INT-009 |
| Re-verify (M01-owned) | INT-011, INT-013 |
| Exit gate (later; human/CI) | `G4_SECURITY` + `_` + `VERIFIED` |
| Frozen shared contracts | **13/13 MATCH** — do not change existing `contracts/shared/**` hashes or `orchestrator/contracts-lock.yaml` 13 rows |
| ADR | ADR-0001; build-plan version `2.5-adr0001` |
| `planning_only` | **true** |
| `implementation_authorized` | **false** |
| Builders dispatched | **0** |
| Uniqueness gate | `cg01_path_uniqueness_gate.py` **unchanged** (M02/M03 remain `READY` / `dispatched: false`) |

Human authorization for **this planning package only**. Wave A/B, host, INT, SEC, EVD, contract freeze, and M06/M08 are **not** dispatched from this slice. Builders do not merge individually. EVD cannot issue G4.

Machine-readable index: `orchestrator/handovers/SF-M05-PLAN.yaml`. Locks: `orchestrator/dispatch/M05-SERIAL-LOCKS.md`. Envelope table: `docs/planning/M05-ENVELOPES.md`. Contract catalog: `docs/planning/M05-CONTRACT-PREREQUISITES.md`. Activation hold: `orchestrator/dispatch/M05-ACTIVATION.md`.

## 1. Governance sequence (normative)

1. Architecture Constitution (immutable constraints)
2. Frozen shared contracts (13/13 MATCH)
3. M04 module-exit G3 record on `main` (#82; green CI/security/developer-platform)
4. **This pass:** bounded M05 envelopes PLANNING; builders OFF; **no freeze**
5. LOCK-1: planning PR merged; uniqueness/contracts/architecture green; still no builders
6. LOCK-2: **SF-M05-CG-001** (mandatory) identifies and later freezes **NEW** M05 contracts only — after planning merge, **before Wave A**. Status now: `PROPOSED` / `CONTRACT-GUARDIAN-REVIEW-REQUIRED`. `freeze_authorized: false`. Future freeze write scope: `contracts/m05/**` plus append-only NEW rows on `orchestrator/contracts-lock.yaml`; `contracts/shared/**` READ-ONLY. **Not this PR.**
7. LOCK-3: Wave A parallel SF-M05-001 ∥ 002 ∥ 003 ∥ 004
8. LOCK-4: STITCH-A mechanical/format/lockfile on Wave A trees + migrations after immutable heads
9. LOCK-5: Wave B parallel SF-M05-005 ∥ 006 ∥ 007 ∥ 008 after STITCH-A on `origin/main`
10. LOCK-6: STITCH-B Wave B trees + lockfile
11. LOCK-7: SF-M05-009 sole `apps/api` writer (preserve M01–M04 mounts)
12. LOCK-8: INT ∥ SEC (SEC = independent verifier; INT-004/005/006/009 owned + INT-011/013 re-verify)
13. LOCK-9: EVD recommend G4 only → human/CI may later issue M05 `G4_SECURITY_VERIFIED` (still **not** CERTIFIED / G6)
14. M06 and M08 remain OFF until independent later authorization (CG-02 after M05 exit)

## 2. Why Wave A is four lanes

Peer M05 engines consume each other through **later-frozen NEW M05 contracts** plus existing 13 shared envelopes — never unmerged sibling trees. Wave A is the four components whose write trees do not wait on another M05 product merge:

| Task | CMP | Why Wave A |
|---|---|---|
| SF-M05-001 | CMP-015 Application / Case | Authoritative case state, INT-004 submission hot path |
| SF-M05-002 | CMP-016 Workflow Engine | Temporal sequencing only; canonical workflow model (not BPMN runtime) |
| SF-M05-003 | CMP-017 Work Queue / Human Task | Human-task lifecycle; INT-005 officer action path |
| SF-M05-004 | CMP-029 SLA & Escalation | SLA clock / pause-resume engine; consumed by deficiency via port |

Wave B (after STITCH-A on `main`; consume Wave A through frozen ports):

| Task | CMP | Wait |
|---|---|---|
| SF-M05-005 | CMP-018 Inspection / Verification | After case + task + workflow ports on `main` |
| SF-M05-006 | CMP-019 Deficiency | After case + SLA + INT-009 clock port on `main` |
| SF-M05-007 | CMP-027 Grievance | After workflow + task ports on `main` |
| SF-M05-008 | CMP-028 Appeal | After case + workflow ports on `main` |

## 3. Topology

```text
[M04 G3 issued + recorded on main b286ed95…] + [13/13 FROZEN]
                    |
        [THIS PASS: M05 PLANNING envelopes; builders OFF; no freeze]
                    |
                 LOCK-1 merge
                    |
                 LOCK-2 SF-M05-CG-001 (NEW M05 contracts only; later)
                    |
        +-----------+-----------+-----------+
        |           |           |           |
     001 CMP-015  002 CMP-016  003 CMP-017  004 CMP-029
        |           |           |           |
        +-----------+-----------+-----------+
                    |
                 LOCK-4 STITCH-A (Wave A trees + lockfile; mechanical only)
                    |
        +-----------+-----------+-----------+
        |           |           |           |
     005 CMP-018  006 CMP-019  007 CMP-027  008 CMP-028
        |           |           |           |
        +-----------+-----------+-----------+
                    |
                 LOCK-6 STITCH-B (Wave B trees + lockfile)
                    |
                 LOCK-7 SF-M05-009 apps/api single writer
                    |
              INT ∥ SEC  then  EVD recommend G4
                    |
              human G4 only; CERTIFIED/G6 false; M06/M08 OFF
```

## 4. Architecture (binding)

- CMP-015 owns authoritative case state. Temporal sequences; it is not authoritative.
- Never advance case state before CMP-015 commit. Short PostgreSQL transaction + outbox. No external I/O in that transaction. Idempotent consumers.
- Pin published versions: application ↔ TenantServiceBinding ↔ workflow ↔ rule/form/evidence. Immutable published workflows. No silent in-flight migration.
- Temporal is the durable runtime. BPMN 2.0 is import/export only, not a second runtime.
- Dynamic assignment: role + organization/office + jurisdiction + service scope. Never a named officer in published workflow.
- OPA = authorization; RLS = tenant data; GoRules = statutory/deterministic; Temporal = orchestration. Do not merge these.
- AI never approve / reject / penalty / statutory decision.
- Payment CMP-021 is M06 (port / SIMULATED callback only). Notification CMP-025 is M06 (port only). DigiLocker CMP-012 is M07 (INT-006 SIMULATED). No SMS/email/DigiLocker/payment **implementation** in M05.

## 5. Residual / non-goals (this slice)

- No product code (`services/**`, `apps/**`, `contracts/**`, migrations, `pnpm-lock.yaml`)
- No Wave A/B/host/INT/SEC/EVD dispatch
- No contract freeze; no edit of `orchestrator/contracts-lock.yaml`
- No merge of this PR by the planning agent
- No uniqueness-gate edit
- No M06/M08 envelopes
- No CERTIFIED / G6 claim
- EVD cannot issue G4
