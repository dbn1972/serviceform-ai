# M04 plan: Forms, Rules, Evidence, Upload, Document Intelligence, AI Gateway (PLANNING/READY)

**Decision token (split against CKV_SECRET_6):** family `M04_PLANNING_READY` + status `READY` (do **not** join).  
**Envelope state:** `READY`. **Not dispatched.** Not CERTIFIED. Not RELEASE CERTIFIED. Not G6. **M05 OFF.**

| Field | Value |
|---|---|
| Module | M04 |
| After | M02 and M03 `G3_INTEGRATION` + `_` + `VERIFIED` (issued; recorded on `main`) |
| Components | CMP-008, CMP-009, CMP-011, CMP-013, CMP-014, CMP-039 |
| Owned numbered INT | none (`specs/build-plan.yaml` `integrations: []`) |
| Re-verify | INT-011, INT-013 (independent later; not owned here) |
| Exit gate (later) | `G3_INTEGRATION_VERIFIED` |
| Planning baseline | prefix `df6a4af1` + suffix `fc7c300616b59a34cf363db80be642e4` |
| Frozen contracts | **13/13 MATCH** — do not change `contracts/**` or `orchestrator/contracts-lock.yaml` |
| ADR | ADR-0001; build-plan version `2.5-adr0001` |
| `planning_only` | **false** (READY-shaped envelopes; this slice still does not dispatch) |
| `implementation_authorized` | **true** (envelopes authorized as READY; builders remain OFF) |
| Builders dispatched | **0** |
| Uniqueness gate | `cg01_path_uniqueness_gate.py` **unchanged** (not weakened) |

Human Debabrata Nayak authorized **this planning/READY package only**. Wave A/B, host, INT, SEC, EVD, and M05 are **not** dispatched from this slice.

Machine-readable index: `orchestrator/handovers/SF-M04-PLAN.yaml`. Locks: `orchestrator/dispatch/M04-SERIAL-LOCKS.md`. Envelope table: `docs/planning/M04-ENVELOPES.md`.

## 1. Governance sequence (normative)

1. Architecture Constitution (immutable constraints)
2. Frozen shared contracts (13/13 MATCH)
3. M02 and M03 module-exit G3 records on `main` (complete for planning)
4. **This pass:** bounded M04 envelopes READY; builders OFF
5. LOCK-1: planning PR merged; uniqueness/contracts/architecture green
6. LOCK-2: Wave A parallel SF-M04-001 … 004 (later dispatch record required)
7. LOCK-3: STITCH-A lockfile-only after immutable Wave A heads
8. LOCK-4: Wave B window after STITCH-A on `origin/main`
9. LOCK-5: SF-M04-005 (CMP-009) after CMP-008 + CMP-011
10. LOCK-6: SF-M04-006 (CMP-014) after CMP-039 + CMP-013
11. LOCK-7: STITCH-B → single-writer SF-M04-007 (`apps/api`) → INT ∥ SEC → EVD
12. Human/CI may later issue M04 `G3_INTEGRATION_VERIFIED` (still **not** CERTIFIED / G6)
13. M05 remains OFF until that independent G3

## 2. Why Wave A is four lanes

Peer M04 engines consume each other through FROZEN contracts/ports, not unmerged sibling trees. Wave A therefore runs the four components that are not waiting on another M04 merge:

| Task | CMP | Why Wave A |
|---|---|---|
| SF-M04-001 | CMP-008 Rules | GoRules metadata engine; peers 009/011 via ports |
| SF-M04-002 | CMP-011 Evidence | Requirement engine; DigiLocker SIMULATED (INT-013) |
| SF-M04-003 | CMP-013 Upload | Uses M01 CMP-032 on `main`; OCR is later |
| SF-M04-004 | CMP-039 AI Gateway | Must exist before any model-calling component (CMP-014) |

Wave B:

| Task | CMP | Wait |
|---|---|---|
| SF-M04-005 | CMP-009 Forms | After 008+011 **and** STITCH-A on `main` (JSON Forms runtime + UX4G renderers) |
| SF-M04-006 | CMP-014 OCR / document intelligence | After 039+013 **and** STITCH-A on `main` (all model calls via CMP-039) |

## 3. Topology

```text
[M02 G3 issued] + [M03 G3 issued] + [13/13 FROZEN]
                    |
        [THIS PASS: M04 READY envelopes; builders OFF]
                    |
                 LOCK-1 merge
                    |
        +-----------+-----------+-----------+
        |           |           |           |
     001 CMP-008  002 CMP-011  003 CMP-013  004 CMP-039
        |           |           |           |
        +-----------+-----------+-----------+
                    |
                 LOCK-3 STITCH-A (pnpm-lock.yaml only)
                    |
                 LOCK-4 STITCH-A on main
                    |
           +--------+--------+
           |                 |
     LOCK-5 005 CMP-009   LOCK-6 006 CMP-014
           |                 |
           +--------+--------+
                    |
                 LOCK-7 STITCH-B (lockfile)
                    |
                 SF-M04-007 apps/api single writer
                    |
              INT ∥ SEC  then  EVD
                    |
              recommend G3 only; M05 OFF
```

## 4. AI / statute boundary

- AI never makes a final statutory eligibility, approval, or rejection decision.
- Every model call in M04 (and after) goes through CMP-039.
- GoRules (CMP-008) remains the deterministic rule executor; OPA remains authorization; PostgreSQL RLS remains the tenant data boundary.

## 5. Residual / non-goals (this slice)

- No product code (`services/**`, `apps/**`, `contracts/**`, migrations, `pnpm-lock.yaml`)
- No Wave A/B/host/INT/SEC/EVD dispatch
- No merge of this PR by the planning agent
- No uniqueness-gate edit
- No M05 envelopes
- No CERTIFIED / G6 claim
