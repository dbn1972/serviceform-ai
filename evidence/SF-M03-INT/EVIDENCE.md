# SF-M03-INT — independent integration evidence

**Recommended result: `V1_INTEGRATION_FAIL`** (no waiver)  
**`CROSS_TENANT_LEAKAGE=0`**  
**Not CERTIFIED. Does not claim `G3_INTEGRATION_VERIFIED`. Not G6 / RELEASE CERTIFIED.**

Independent integration stitcher. Frozen contracts and production domain code were not modified.

| Field | Value |
|---|---|
| Task | SF-M03-INT |
| Human authorizer | Debabrata Nayak |
| Host merge | [#57](https://github.com/dbn1972/serviceform-ai/pull/57) `7424235592824d5ceda9dcac55380a78c05cb6c5` |
| Evidence branch | `cursor/m03-int-verify-9ef2` |
| Independent run id | `local-m03-int` / job `independent-m03-integration` |
| PostgreSQL | 16.15 (local cluster, SIMULATED/LOCAL connectors) |
| Frozen contracts | 13/13 MATCH (`contracts_lock_gate.py`) |
| Post-merge CI corroboration | [ci 37195753267](https://github.com/dbn1972/serviceform-ai/actions/runs/37195753267) + [security 37195753178](https://github.com/dbn1972/serviceform-ai/actions/runs/37195753178) + [developer-platform 37195753176](https://github.com/dbn1972/serviceform-ai/actions/runs/37195753176) — 14/14 SUCCESS on `7424235`; **not** a substitute for this independent run |

## Executed suites (this verifier)

| Suite | Result | Notes |
|---|---|---|
| Frozen contracts lock | PASS | 13/13 |
| Independent INT-013 REAL/SANDBOX/SIMULATED matrix | PASS | CMP-033/034/051/052/053 fail-closed; LOCAL/CI SIMULATED allowed |
| Independent INT-011 host `x-tenant-id` | PASS | SF-TEN-002, no canary echo |
| Host `composition-m03.test.ts` | PASS | 5 tests |
| CMP-050 INT-002 client unit + contracts | PASS | 7 tests |
| CMP-054 UX4G foundation | PASS | 20 tests |
| CMP-001 `test:integration` | **FAIL** | 7/8; see defect below. Owner **CMP-001**. Not patched. |
| CMP-033 envelope INT | PASS | 8 tests |
| CMP-034 envelope INT | PASS | 6 tests (incl. SIMULATED import) |
| CMP-051 envelope INT | PASS | 7 tests (maker-checker + INT-013 port fail-closed) |
| CMP-052 envelope INT | PASS | 6 tests |
| CMP-053 envelope INT | PASS | 5 tests (assist SIMULATED) |
| Independent INT-002 HTTP stitch (033+051+052 LOGIN) | PASS | validate → binding → checker approve → publish; T2 denied |
| Independent INT-011 LOGIN RLS catalog | PASS | `CROSS_TENANT_LEAKAGE=0` |
| CMP-034/051/052/053 unit (INT-013 modes) | PASS | |

Machine summary: `evidence/SF-M03-INT/summary.json`. RLS: `summary/cross-tenant.json`.

## Connector modes (INT-013)

Environment for this run: **LOCAL/CI SIMULATED** (no REAL DEPARTMENT_API / schema-registry / approval adapters shipped). REAL and SANDBOX paths **fail closed** (`ADAPTER_UNAVAILABLE` / `*_REAL_FORBIDDEN`). PRODUCTION SIMULATED refused. Matches INT-013; not a silent SIMULATED-in-production.

## Defect (blocking recommended PASS; not waived)

**Owner: CMP-001.** `privilege-boundary.int.test.ts` “insert-only offering versions”: first `UPDATE` is correctly rejected (`42501`), which aborts the PostgreSQL transaction; the following `INSERT` is asserted as `42501` but PostgreSQL returns `25P02` (`current transaction is aborted`). Deterministic on a clean DB at `7424235`. Independent stitcher did **not** patch component tests or production SQL.

RLS/tenant-negative cases in the same file still passed; leakage count remains 0.

## Residuals (non-blocking if CMP-001 is later fixed)

- CMP-050 INT-002 client `approve`/`reject` omit CMP-051 required `reason`. Stitch used checker `inject` with reason. Owner CMP-050.
- ADR-0001: published workflow compile-and-run is M05; M03 INT-002 stops at TenantServiceBinding publication.
- CMP-050/054 are not Fastify-mounted (host composition by design).
- Full M01 Kafka envelope INT was corroborated by post-merge CI job `M01 envelope integration`, not re-executed in this local run (no Kafka/OPA in this environment). M03 INT-011 re-verify is for **layers M03 adds**.

## Explicit non-claims

- Not VERIFIED / not CERTIFIED / not `G3_INTEGRATION_VERIFIED`
- SF-M03-SEC and SF-M03-EVD not started
- M04 not started
