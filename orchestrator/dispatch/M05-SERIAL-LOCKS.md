# M05 hard serial locks (LOCK-1 … LOCK-9)

PLANNING record only. **Not dispatched. Not CERTIFIED. Not G6.** Implementation OFF. M06/M08 remain OFF.

Authoritative planning base: `origin/main` prefix `b286ed95` + suffix `6755b936f73bc2856c9db2c68d8ca64c` (post M04 G3 record #82).  
ADR-0001 and `specs/build-plan.yaml` version `2.5-adr0001` remain binding.

These locks are **hard serial**. A later envelope must not start until the named predecessor is satisfied on `origin/main` (or an immutable SHA-pinned head where the lock says so).

**Normative topology (wording only; architecture/build-plan unchanged):**  
PLANNING → SF-M05-CG-001 freeze → Wave A `001∥002∥003∥004` → STITCH-A → Wave B `005∥006∥007∥008` → STITCH-B → `009` → `INT∥SEC` → EVD.  
Parallel builder sets are Wave A (001–004 under LOCK-3) and Wave B (005–008 under LOCK-5). CG freeze, stitches, host, and EVD remain serial. INT ∥ SEC only after host.

| Lock | Gate | May start | Must wait for |
|---|---|---|---|
| LOCK-1 | Planning merge | Envelope files on `main`; uniqueness/contracts/architecture green | This planning PR merged; **no builder spawn in this slice**; **no freeze in this slice** |
| LOCK-2 | SF-M05-CG-001 | Contract guardian for **NEW** M05 contracts (`PROPOSED` → freeze later) | LOCK-1; later freeze authorization; CCR+STOP if existing 13 frozen hashes must change |
| LOCK-3 | Wave A parallel | SF-M05-001, SF-M05-002, SF-M05-003, SF-M05-004 only | LOCK-2 freeze **on origin/main**; later orchestrator dispatch record; uniqueness still PASS |
| LOCK-4 | STITCH-A | SF-M05-STITCH-A (Wave A paths + migrations + `pnpm-lock.yaml`; mechanical/format/lockfile only) | LOCK-3; Wave A heads **immutable**; not concurrent with 001–004 |
| LOCK-5 | Wave B parallel | SF-M05-005, SF-M05-006, SF-M05-007, SF-M05-008 | LOCK-4; STITCH-A **on origin/main** |
| LOCK-6 | STITCH-B | SF-M05-STITCH-B (Wave B paths + migrations + `pnpm-lock.yaml`; mechanical only) | Wave B heads immutable; not concurrent with STITCH-A or 005–008 |
| LOCK-7 | Host | SF-M05-009 sole `apps/api` writer | STITCH-B on `main`; preserve M01–M04 mounts |
| LOCK-8 | Verifiers | SF-M05-INT ∥ SF-M05-SEC | SF-M05-009 on `main` |
| LOCK-9 | Evidence | SF-M05-EVD recommend G4 only | INT and SEC; EVD **cannot issue G4**; human/CI later |

## Uniqueness

`scripts/gates/cg01_path_uniqueness_gate.py` is **not** weakened and is **not** extended in this planning slice (it remains the CG-01 M02/M03 READY/`dispatched: false` gate). M05 envelopes keep `state: PLANNING` and `dispatched: false`. Wave A and Wave B write paths do not overlap across concurrent lanes (see `docs/planning/M05-ENVELOPES.md`).

`pnpm-lock.yaml`, existing frozen shared contracts, and `orchestrator/contracts-lock.yaml` (13 rows) stay forbidden for builders. STITCH-A/B are the only M05 envelopes allowed to write `pnpm-lock.yaml`, and they never run concurrent with each other.

## Dispatch hold

This planning package does **not** dispatch CG freeze, Wave A/B, host, INT, SEC, or EVD. M06/M08 stay OFF. Agents do not self-certify. EVD cannot issue G4.
