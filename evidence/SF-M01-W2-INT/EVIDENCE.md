# SF-M01-W2-INT — independent V1 integration evidence

**Result: `V1_INTEGRATION_PASS`**  
**`CROSS_TENANT_LEAKAGE=0`**  
**Not CERTIFIED.** Frozen contracts and production domain code were not modified. Stitch PR #30 was not merged.

| Field | Value |
|---|---|
| Task | SF-M01-W2-INT |
| Verifier | Independent integration stitcher (not Wave 2 builders / STITCH agent) |
| Candidate tip | `347fe74cb0221cbc0b8542bb187aa6adc752405c` |
| Stitch PR / branch | [#30](https://github.com/dbn1972/serviceform-ai/pull/30) `cursor/m01-w2-stitch-e19b` |
| Independent run id | `local-w2-int` / job `independent-w2-integration` |
| GitHub ci (confirm only) | [37169194082](https://github.com/dbn1972/serviceform-ai/actions/runs/37169194082) SUCCESS — envelope job `111338489009` SUCCESS; **not** treated as substitute for independent INT |
| Components | CMP-003, CMP-030, CMP-032, CMP-036, CMP-047, CMP-055 (+ W1 INT-011 re-verify) |
| Integration IDs | INT-011, INT-013 |
| Frozen contracts | 13/13 MATCH (`contracts_lock_gate.py`) |

## Environment

PostgreSQL 16.15, Kafka 4.1.0 (`/var/tmp/kafka/kafka_2.13-4.1.0`), OPA 1.21.1, OpenJDK 17.0.20.1, Node 22 / pnpm 10.28.0, `pnpm install --frozen-lockfile` PASS on tip.

## Executed suites (this verifier)

| Suite | Result | Detail |
|---|---|---|
| Frozen contracts lock | PASS | 13/13 |
| CMP-003 `test:integration` | PASS | 3 files / 6 tests (API, migration, privilege/RLS) |
| CMP-030 `test:integration` | PASS | 3 files / 6 tests |
| CMP-032 `test:integration` | PASS | 3 files / 6 tests (RLS/API INT-011+013, privilege, migration) |
| `@serviceform/storage` unit (INT-013 markers) | PASS | 5 files / 12 tests |
| CMP-032 unit/contract (mode refusal) | PASS | 3 files / 9 tests |
| Host composition Wave 2 Phase B | PASS | 7 tests incl. CMP-003/030/032 mounts |
| CMP-036 edge unit | PASS | 6 tests |
| CMP-047 plugin unit | PASS | 2 tests |
| CMP-055 unit | PASS | 3 files / 9 tests |
| W1 envelope `run-m01-envelope-int.sh` | PASS | 7/7 (`fail_count: 0`) — CMP-002/048/031/038/037 + OPA + CDC |
| `pnpm deps:graph` | PASS | no cross-component import violations |

Machine summary: `summary/v1-integration-summary.json`. W1 envelope: `m01-envelope-int/summary.json`.

## Residuals (non-blocking for V1)

- No dedicated Wave 2 cross-component CDC suite yet (W1 CDC re-verified; W2 OpenAPI CDC not present).
- CMP-036/047 have no PostgreSQL `*.int.test.ts` suites; host composition + unit cover mounts/telemetry ordering.
- REAL S3/KMS storage infra deferred (SIMULATED path verified under INT-013).
- Shared migration timestamp prefix residual noted by stitch (lint PASS).

## Explicit non-claims

- Not VERIFIED / Not CERTIFIED
- Do not merge stitch to `main` from this evidence alone
- SEC / EVD remain independent
