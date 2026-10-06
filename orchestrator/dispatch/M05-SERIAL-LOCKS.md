# M05 hard serial locks (LOCK-1 … LOCK-9)

Wave B READY control-plane record. **Builders NOT DISPATCHED by this PR. Not CERTIFIED. Not G6.** G4 NOT ISSUED. M06/M08 remain OFF.

Authoritative Wave B READY parent: `origin/main` `905afad22b2112182ff17095272c7c34de4726a9` (STITCH-A **MERGED_AND_VERIFIED_ON_MAIN**, PR #95). Envelope `base_commit` prefix `905afad2` + suffix `2b2112182ff17095272c7c34de4726a9` is **activation provenance ONLY**.

ADR-0001 and `specs/build-plan.yaml` version `2.5-adr0001` remain binding.

These locks are **hard serial**. A later envelope must not start until the named predecessor is satisfied on `origin/main` (or an immutable SHA-pinned head where the lock says so).

**Normative topology (wording only; architecture/build-plan unchanged):**  
PLANNING → SF-M05-CG-001 freeze → Wave A `001∥002∥003∥004` **COMPLETE** → STITCH-A **MERGED_AND_VERIFIED** → Wave B `005∥006∥007∥008` **READY** (this package; not dispatched) → STITCH-B **OFF** → `009` **OFF** → `INT∥SEC` **OFF** → EVD **OFF**.  
Parallel builder sets are Wave A (001–004 under LOCK-3; complete) and Wave B (005–008 under LOCK-5; READY after this activation PR merges). CG freeze, stitches, host, and EVD remain serial. INT ∥ SEC only after host.

| Lock | Gate | Status | Must wait for |
|---|---|---|---|
| LOCK-1 | Planning merge | **SATISFIED** | Planning PR merged; uniqueness/contracts/architecture green |
| LOCK-2 | SF-M05-CG-001 | **SATISFIED** | NEW M05 contracts FROZEN on `origin/main`; 19/19 MATCH |
| LOCK-3 | Wave A parallel | **SATISFIED** | 001–004 complete as stitched trees on main |
| LOCK-4 | STITCH-A | **SATISFIED** — STITCH-A **MERGED_AND_VERIFIED_ON_MAIN** SHA `905afad22b2112182ff17095272c7c34de4726a9` | Wave A heads immutable; not concurrent with 001–004 |
| LOCK-5 | Wave B parallel | **Wave B READY eligible after this activation PR merges**; builders **NOT DISPATCHED** by this PR | LOCK-4 SATISFIED; later HUMAN WAVE B DISPATCH AUTHORIZATION (`dispatch_authorized` still false here) |
| LOCK-6 | STITCH-B | **OFF** | Wave B heads immutable; not concurrent with STITCH-A or 005–008 |
| LOCK-7 | Host | **OFF** | STITCH-B on `main`; preserve M01–M04 mounts |
| LOCK-8 | Verifiers | **OFF** | SF-M05-009 on `main` |
| LOCK-9 | Evidence | **OFF** | INT and SEC; EVD **cannot issue G4**; human/CI later |

## Uniqueness

`scripts/gates/cg01_path_uniqueness_gate.py` is **not** weakened (it remains the CG-01 M02/M03 READY/`dispatched: false` gate). Wave B 005–008 keep non-overlapping product/migration/evidence/handover writes. Pairwise overlap must remain 0. Shared writable `pnpm-lock.yaml` / `contracts/**` / `apps/**` among 005–008 is **false**.

`pnpm-lock.yaml`, existing frozen shared contracts, and `orchestrator/contracts-lock.yaml` stay forbidden for Wave B builders. STITCH-B is the only later M05 envelope allowed to write `pnpm-lock.yaml` for Wave B trees, and it never runs concurrent with STITCH-A or 005–008.

## Dispatch hold

This Wave B READY package does **not** dispatch 005–008 builders, STITCH-B, host, INT, SEC, or EVD. `dispatch_authorized: false`. `dispatch_base: null`. Future dispatch source is a **SEPARATE HUMAN WAVE B DISPATCH AUTHORIZATION**. M06/M08 stay OFF. Agents do not self-certify. EVD cannot issue G4.
