# SF-M01-G4-002 — full M01 regression evidence

**Result: `M01_G4_REGRESSION_PASS` / `SF-M01-G4-002_READY`**  
**`CROSS_TENANT_LEAKAGE=0`**  
**Not CERTIFIED.** Additive harness + evidence only. Frozen contracts and production domain code were not modified. No M02/M03.

| Field | Value |
|---|---|
| Task | SF-M01-G4-002 |
| Role | Independent integration stitcher (regression harness) |
| Main tip baseline | `ab8359f0ffe96834bdf61318d1db7877433e7dcc` (envelopes READY / PR #35) |
| Harness tip under test | `9696f48b9da62154493eef598f77cf94982f28de` |
| Verification PR / branch | [#38](https://github.com/dbn1972/serviceform-ai/pull/38) `cursor/m01-g4-regression-1041` |
| Independent run id | `local-g4-002` / job `m01-g4-regression` |
| GitHub `ci` (main tip) | [37178714591](https://github.com/dbn1972/serviceform-ai/actions/runs/37178714591) **SUCCESS** — envelope job `111366681172` SUCCESS |
| GitHub `security` (main tip) | [37178714612](https://github.com/dbn1972/serviceform-ai/actions/runs/37178714612) **SUCCESS** (semgrep, CodeQL, checkov, gitleaks, dependency audit) |
| Components | All 11: CMP-002/003/030/031/032/036/037/038/047/048/055 |
| Integration IDs | INT-011, INT-013 |
| Frozen contracts | 13/13 MATCH (`contracts_lock_gate.py`) |

## Environment

PostgreSQL 16.15, Kafka 4.1.0 (`/var/tmp/kafka/kafka_2.13-4.1.0`), OPA 1.21.1, OpenJDK 17.0.20.1, Node 22 / pnpm 10.28.0, `pnpm install --frozen-lockfile` PASS.

## Executed suites

Machine summary: `summary/m01-g4-regression-summary.json` (`suite_count: 22`, `fail_count: 0`).

| Layer | Result | Detail |
|---|---|---|
| Frozen contracts lock | PASS | 13/13 |
| `pnpm deps:graph` | PASS | no cross-component import violations |
| `migration_lint` + `pnpm gates` | PASS | architecture gates fail-closed |
| W1 envelope INT | PASS | CMP-002/048/031/038/037 + OPA + CDC (`fail_count: 0`) |
| CMP-003 / 030 / 032 `test:integration` | PASS | INT-011 RLS/privilege/API |
| `@serviceform/storage` + CMP-032 unit | PASS | INT-013 SIMULATED markers |
| Host composition | PASS | 7 tests W1+W2 mounts + CMP-047 redaction |
| CMP-036 edge / CMP-047 plugin | PASS | forged tenant header denied; telemetry plugin |
| CMP-055 path-based unit | PASS | 9 tests (no `package.json` on main) |
| Coverage-matrix contract | PASS | harness names all 11 CMPs |
| GitHub ci + security (main tip) | PASS | SUCCESS on `ab8359f` |

## Hard gates observed

- `CROSS_TENANT_LEAKAGE=0`
- OPA PEP fail-closed + privilege-boundary LOGIN exercised via W1/W2 INT
- Integration Hub SIMULATED (CMP-037) + Storage SIMULATED markers (CMP-032 / INT-013)
- Audit / outbox / inbox via CMP-031 + CMP-038 envelope suites
- Gates not weakened; no `continue-on-error`

## Residuals (non-blocking for this envelope)

- **R-ENV-INT:** CI job name/script still W1-scoped on tip until SF-M01-G4-001 lands. This harness covers W1+W2 independently; does not close the CI residual.
- **CMP-055-PKG:** no `package.json` on main — path-based vitest used.
- PR head CI for harness tip tracked separately on [#38](https://github.com/dbn1972/serviceform-ai/pull/38).

## Explicit non-claims

- Not VERIFIED / Not CERTIFIED / not RELEASE CERTIFIED / not G6
- Does not issue M01 exit record token (`M01`/`COMPLETE`/`G4_SECURITY`/`VERIFIED`)
- Does not start M02 / M03 / CG-01
- Does not patch production services to force green
