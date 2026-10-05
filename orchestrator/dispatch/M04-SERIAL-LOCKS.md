# M04 hard serial locks (LOCK-1 … LOCK-7)

Planning/READY record only. **Not dispatched. Not CERTIFIED. Not G6.** M05 remains OFF.

Authoritative STITCH-B planning base: `origin/main` prefix `2db721fe` + suffix `b1303385a0c50c79de8629b2478064d9` (post STITCH-A).  
ADR-0001 and `specs/build-plan.yaml` version `2.5-adr0001` remain binding.

These locks are **hard serial**. A later envelope must not start until the named predecessor is satisfied on `origin/main` (or an immutable SHA-pinned head where the lock says so).

**Normative topology (wording only; architecture/build-plan unchanged):**  
Wave A `001∥002∥003∥004` → STITCH-A → Wave B `005∥006` → STITCH-B → `007` → `INT∥SEC` → EVD.  
Parallel builder sets are Wave A (001–004 under LOCK-2) and Wave B (005∥006 under LOCK-4/5/6). Stitches, host, and verifiers remain serial per the locks below.

| Lock | Gate | May start | Must wait for |
|---|---|---|---|
| LOCK-1 | Planning merge | Envelope files on `main`; uniqueness/contracts/architecture green | This planning PR merged; **no builder spawn in this slice** |
| LOCK-2 | Wave A parallel | SF-M04-001, SF-M04-002, SF-M04-003, SF-M04-004 only | LOCK-1; later orchestrator dispatch record; uniqueness still PASS |
| LOCK-3 | STITCH-A | SF-M04-STITCH-A (Wave A paths + migrations + `pnpm-lock.yaml`; mechanical/format/lockfile only) | LOCK-2; Wave A heads **immutable** (merged to `main` or SHA-pinned); not concurrent with 001–004 |
| LOCK-4 | Wave B window | SF-M04-005 and/or SF-M04-006 (still constrained by LOCK-5/LOCK-6) | LOCK-3; STITCH-A **on origin/main** |
| LOCK-5 | Forms after rules+evidence | SF-M04-005 (CMP-009) | LOCK-4; CMP-008 (SF-M04-002) and CMP-011 (SF-M04-003) on `main` |
| LOCK-6 | OCR after gateway+upload | SF-M04-006 (CMP-014) | LOCK-4; CMP-039 (SF-M04-001) and CMP-013 (SF-M04-004) on `main` |
| LOCK-7 | STITCH-B then host then verifiers | SF-M04-STITCH-B (Wave B paths + migrations + `pnpm-lock.yaml`; mechanical/format/lockfile only) → SF-M04-007 → (SF-M04-INT ∥ SF-M04-SEC) → SF-M04-EVD | Wave B heads immutable (SHA-pinned; do not merge #74/#75); STITCH-B on `main` before host; host on `main` before INT∥SEC; both INT and SEC before EVD |

## Uniqueness

`scripts/gates/cg01_path_uniqueness_gate.py` is **not** weakened and is **not** extended in this planning slice (it remains the CG-01 M02/M03 READY/`dispatched: false` gate). M04 envelopes keep `state: READY` and `dispatched: false`. Write paths below do not overlap across concurrent lanes.

`pnpm-lock.yaml`, `contracts/**`, and `orchestrator/contracts-lock.yaml` stay forbidden for builders. STITCH-A/B are the only M04 envelopes allowed to write `pnpm-lock.yaml`, and they never run concurrent with each other. STITCH-A may rewrite Wave A service/migration paths only after LOCK-3 (serial vs 001–004); no semantic redesign. STITCH-B may rewrite Wave B service/migration paths only after LOCK-7 start (serial vs 005–006 product builders); integrate exact immutable trees only; no semantic redesign.

## Dispatch hold

This planning correction does **not** dispatch product STITCH-B, Wave B merge, host, INT, SEC, or EVD. M05 is OFF until M04 `G3_INTEGRATION_VERIFIED` is independently issued (human/CI). Agents do not self-certify.
