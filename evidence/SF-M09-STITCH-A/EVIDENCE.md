# SF-M09-STITCH-A — CG-03 Wave A mechanical stitch

- Role: integration_agent / serviceform-integration-stitcher
- Authorization: `HUMAN_CG03_THROUGH_EVD_AUTHORIZATION`
- Base: `origin/main` @ `fd7492b` (Wave A READY #159)
- Branch: `cursor/m09-stitch-a-91f2`
- Status: CANDIDATE_COMPLETE. NOT CERTIFIED. G4/G6 false.

## Gate

Nine Wave A DRAFT PRs had exact-head CI + Security + Developer Platform SUCCESS before stitch execution.

| PR | Tip | Envelope |
|---|---|---|
| #164 | `beaf82b` | SF-M09-001 CMP-056 |
| #167 | `4d64c24` | SF-M09-002 CMP-057 |
| #160 | `311f465` | SF-M09-003 CMP-058 |
| #163 | `185a320` | SF-M09-004 CMP-059 |
| #166 | `0839f35` | SF-M09-005 CMP-060 |
| #168 | `d2f72ff` | SF-M09-006 CMP-061 |
| #161 | `ef09b75` | SF-M10-001 (M10 trees co-admitted) |
| #162 | `382e604` | SF-M10-002 |
| #165 | `3d88793` | SF-M10-003 |

Canonical SF-M09-001 tip is **#164** (not `cursor/m09-001-scheduler-1281`).

## Change set

| Path | Change |
|---|---|
| `services/cmp-056..061/**` | BYTE_IDENTICAL copy from green DRAFT tips |
| `db/migrations/*_cmp-05{6,7,8,9}-*`, `*_cmp-060-*`, `*_cmp-061-*` | BYTE_IDENTICAL |
| `templates/residence-certificate/**`, `packages/service-packages/ind-soc-002/**` | from #161 |
| `fixtures/golden/ind-soc-002/**` | from #162 |
| `tests/integration/m10/**`, `tests/e2e/golden/ind-soc-002-golden.spec.ts` | from #165 |
| `pnpm-lock.yaml` | Admit importers (empty `{}` for 056/057/061; deps for 058/059/060) |
| `evidence/SF-M09-STITCH-A/**`, `evidence/SF-M10-STITCH-A/**` | stitch evidence |
| `orchestrator/handovers/SF-M09-STITCH-A.yaml`, `SF-M10-STITCH-A.yaml` | CANDIDATE_COMPLETE |

## Local gates

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm contracts:validate` | PASS (12 contracts) |
| `migration_lint.py` | PASS (100 files) |
| `contracts_lock_gate.py` | PASS (42/42 FROZEN) |
| `run_all.py` | PASS 10/10 |
| Package unit (056..061) | 22+30+35+32+30+27 PASS |
| M10 harness vitest | 17 pass / 7 todo |

## Not claimed

CERTIFIED=false · G4=false · G6=false · self_certified=false.  
Builder PRs #160–#168 remain OPEN DRAFT (not merged by this stitch).  
M10 remains POLICY_INPUT_REQUIRED for owner statute/fee/SLA inputs.
