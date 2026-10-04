# SF-M01-G4-001 — Fix R-ENV-INT (generalize M01 envelope-int)

**Result: `SF-M01-G4-001_READY` (builder delivery; not CERTIFIED)**  
**Residual R-ENV-INT: closed in code on this PR tip (GitHub job authoritative for full INT)**  
**Not CERTIFIED. Gates not weakened.**

| Field | Value |
|---|---|
| Task | SF-M01-G4-001 |
| Scope | Generalize GitHub `m01-envelope-int` beyond SF-M01-001..005 |
| Main baseline | `ab8359f0ffe96834bdf61318d1db7877433e7dcc` (`origin/main`, envelopes READY; code ancestry `c42c7c8`) |
| Branch | `cursor/m01-g4-r-env-int-1573` |
| Implementation SHA | `125a81ff9aa0e0cc5b381f0e7001bd0522ed9614` |
| Evidence main bind | `ab8359f0ffe96834bdf61318d1db7877433e7dcc` |
| Allowed writes | `.github/workflows/ci.yml`, `scripts/ci/run-m01-envelope-int.sh`, `evidence/SF-M01-G4-001/**`, `orchestrator/handovers/SF-M01-G4-001.yaml` |
| Frozen contracts | untouched (13/13) |
| M02 / M03 | not started |

## Change summary

1. **Job rename** — `M01 envelope integration (SF-M01-001..005)` → `M01 envelope integration (W1+W2 all CMPs)`.
2. **Script** — `scripts/ci/run-m01-envelope-int.sh` now executes W1 suites (unchanged strength) **plus** W2 CMP-003/030/032 INT, INT-013 markers, host composition, CMP-036/047 units, and CMP-055 path-based unit.
3. **ARTIFACT-INDEX** — `tasks` includes SF-M01-001..005 and SF-M01-W2-001..005; `components` lists all 11 M01 CMPs; `commit_sha` binds PR head / main tip under test.
4. **Fail-closed preserved** — no `continue-on-error`; job still fails on any suite failure; thresholds not lowered (timeout raised 60→90 only to fit added suites).

## Component coverage matrix

| CMP | Task id | Suite surface | Runner |
|---|---|---|---|
| CMP-002 | SF-M01-001 | `*.int` envelope | pnpm filter + integration config |
| CMP-048 | SF-M01-002 | `*.int` + OPA | pnpm filter + `opa:test` |
| CMP-031 | SF-M01-003 | `*.int` envelope | pnpm filter |
| CMP-038 | SF-M01-004 | `*.int` envelope (Kafka) | pnpm filter |
| CMP-037 | SF-M01-005 | `*.int` envelope | pnpm filter |
| CMP-003 | SF-M01-W2-001 | `*.int` envelope | pnpm filter |
| CMP-030 | SF-M01-W2-002 | `*.int` envelope | pnpm filter |
| CMP-032 | SF-M01-W2-003 | `*.int` + unit + `@serviceform/storage` INT-013 | pnpm filter |
| CMP-036 | SF-M01-W2-004 | host composition + edge unit | path vitest |
| CMP-047 | SF-M01-W2-004 | plugin unit | path vitest |
| CMP-055 | SF-M01-W2-005 | path unit (no `package.json`) | path vitest |
| CDC | CDC | `pnpm test:cdc` | retained |

## Local evidence (this agent)

| Check | Result |
|---|---|
| `bash -n scripts/ci/run-m01-envelope-int.sh` | PASS |
| CI job block has no `continue-on-error` | PASS |
| Path/unit smoke (036/047/055/host + INT-013 markers) | PASS — see `path-smoke/` |
| Full PG+Kafka envelope-int | **GitHub job `m01-envelope-int`** on this PR tip (authoritative) |

Path-smoke details: `path-smoke/summary.json` (binds tip SHA after commit; main baseline `ab8359f`).

## Explicit non-claims

- Not VERIFIED / Not CERTIFIED / not G6
- Does not issue exit record token (`M01`/`COMPLETE`/`G4_SECURITY`/`VERIFIED`)
- Does not start M02/M03
- Does not mutate frozen contracts or weaken security gates
