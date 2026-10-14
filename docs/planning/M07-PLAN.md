# M07 plan: Credentials, QR, Revocation and DigiLocker (PLANNING ONLY)

**Decision token (split against CKV_SECRET_6):** family `M07_PLANNING` + status `PLANNING` (do **not** join).  
**Envelope state:** `PLANNING`. **Not READY.** **Not dispatched.** Not CERTIFIED. Not G6. **Implementation OFF.** **Builders OFF.** **No freeze in this PR.**

| Field | Value |
|---|---|
| Module | M07 (`specs/build-plan.yaml`) |
| Components | CMP-022, CMP-024, CMP-023, CMP-012 |
| Integrations owned | INT-008 |
| Integrations re-verify | INT-011, INT-013 (M01-owned) |
| Exit gate | `G3_INTEGRATION_VERIFIED` (EVD recommend; human/CI issues later) |
| Depends on | M06 G3 (issued) |
| Planning baseline | prefix `fd335e8c` + suffix `fd6a3c616f5133d09191e721201d4ab5` |
| Existing frozen contracts | **29/29 MATCH** — immutable |
| `M07_CONTRACT_FREEZE_REQUIRED` | **true** (NEW contracts; freeze needs SF-M07-CG-001 after this PR) |
| `planning_only` | **true** |
| `implementation_authorized` | **false** |
| Builders dispatched | **0** |
| M09–M12 | **OFF** until M07 G3 (+ M08 already G3 for CG-03) |

Human authorization: `HUMAN_M07_AUTHORIZATION` / `HUMAN_M07_THROUGH_EVD_AUTHORIZATION` (planning slice of that auth). This PR does **not** freeze contracts and does **not** spawn builders.

Machine index: `orchestrator/handovers/SF-M07-PLAN.yaml`. Envelopes: `docs/planning/M07-ENVELOPES.md`. Contracts: `docs/planning/M07-CONTRACT-PREREQUISITES.md`.

## Governance sequence

1. Architecture Constitution + frozen 29 contracts (MATCH)
2. M06 G3 issued; M08 G3 issued (tip `fd335e8c…`)
3. **This pass (LOCK-1):** M07 envelopes PLANNING; no freeze; no READY; no builders
4. LOCK-2: SF-M07-CG-001 NEW `contracts/m07/**` freeze (append-only lock rows; existing 29 immutable)
5. LOCK-3: Wave A parallel SF-M07-001..004 after freeze on `origin/main` + READY + dispatch
6. LOCK-4: STITCH-A mechanical/format/lockfile on Wave A paths
7. LOCK-5: (no Wave B CMPs — all four in Wave A) reserved / no-op unless guardian adds eSign packaging envelope
8. LOCK-6: STITCH-B (lockfile admit remaining importers if needed)
9. LOCK-7: SF-M07-005 host mounts (`composition/m07.ts` + serialized `app.ts`)
10. LOCK-8: INT �005 host mounts (`composition/m07.ts` + serialized `app.ts`)
10. LOCK-8: INT ∥ SEC (INT-008 + INT-011/013 re-verify)
11. LOCK-9: EVD recommend G3 only → human/CI may issue G3

## Topology

```text
[M06 G3 + M08 G3 on main fd335e8c…]
            |
[THIS PASS: M07 PLANNING; builders OFF; no freeze]
            |
     SF-M07-CG-001 (later freeze)
            |
 Wave A: 022 � freeze]
            |
     SF-M07-CG-001 (later freeze)
            |
 Wave A: 022 ∥ 024 ∥ 023 ∥ 012
            |
        STITCH-A
            |
        STITCH-B (if needed)
            |
     SF-M07-005 host
            |
      INT ∥ SEC
            |
     EVD recommend G3
```

## Non-claims

CERTIFIED=false · G3=false · G6=false · self_certified=false · no invented DigiLocker/eSign statutory policy · issuance not reversed by publish/notify outage.
