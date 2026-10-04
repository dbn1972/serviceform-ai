# SF-M03-INT — independent integration evidence (rerun)

**Recommended result: `V1_INTEGRATION_PASS`** (no waiver of remaining residuals)  
**`CROSS_TENANT_LEAKAGE=0`**  
**Not CERTIFIED. Does not claim `G3_INTEGRATION_VERIFIED`. Not G6 / RELEASE CERTIFIED.**  
Envelope YAML remains **`state: READY` / `dispatched: false`**.

Independent integration stitcher. Frozen contracts and production domain code were not modified. CMP-001 production/src/migrations/grants/RLS were not modified. Included test-only privilege-boundary transaction split from draft [#60](https://github.com/dbn1972/serviceform-ai/pull/60) @ `4f784b9`.

| Field | Value |
|---|---|
| Task | SF-M03-INT |
| Human authorizer | Debabrata Nayak |
| Host merge | [#57](https://github.com/dbn1972/serviceform-ai/pull/57) `7424235592824d5ceda9dcac55380a78c05cb6c5` |
| CMP-001 test split | [#60](https://github.com/dbn1972/serviceform-ai/pull/60) `4f784b936ab8e3bc1a5e43226ce9310269463299` (test file only) |
| Evidence branch | `cursor/m03-int-verify-9ef2` |
| Independent run id | `local-m03-int-rerun` / job `independent-m03-integration` |
| PostgreSQL | 16.15 (local cluster, SIMULATED/LOCAL connectors) |
| Frozen contracts | 13/13 MATCH (`contracts_lock_gate.py`) |
| Prior FAIL run | `local-m03-int` — CMP-001 7/8 (`25P02` same-tx). **Superseded by this rerun.** |

## Executed suites (this verifier, rerun)

| Suite | Result | Notes |
|---|---|---|
| Frozen contracts lock | PASS | 13/13 |
| Independent INT-013 REAL/SANDBOX/SIMULATED matrix | PASS | CMP-033/034/051/052/053 fail-closed; LOCAL/CI SIMULATED allowed |
| Independent INT-011 host `x-tenant-id` | PASS | SF-TEN-002, no canary echo |
| Host `composition-m03.test.ts` | PASS | 5 tests |
| CMP-050 INT-002 client unit + contracts | PASS | 7 tests |
| CMP-054 UX4G foundation | PASS | 20 tests |
| CMP-001 `test:integration` | **PASS 8/8** | UPDATE `42501` and pin INSERT `42501` in separate transactions (no `25P02`) |
| CMP-033 envelope INT | PASS | 8 tests |
| CMP-034 envelope INT | PASS | 6 tests |
| CMP-051 envelope INT | PASS | 7 tests |
| CMP-052 envelope INT | PASS | 6 tests |
| CMP-053 envelope INT | PASS | 5 tests |
| Independent INT-002 HTTP stitch (033+051+052 LOGIN) | PASS | validate → binding → checker approve → publish; T2 denied |
| Independent INT-011 LOGIN RLS catalog | PASS | `CROSS_TENANT_LEAKAGE=0` |
| CMP-034/051/052/053 unit (INT-013 modes) | PASS | |

Machine summary: `evidence/SF-M03-INT/summary.json` (`result: PASS`, `fail_count: 0`). RLS: `summary/cross-tenant.json`.

## Connector modes (INT-013)

Environment for this run: **LOCAL/CI SIMULATED**. REAL and SANDBOX paths **fail closed**. PRODUCTION SIMULATED refused.

## Residuals (non-blocking for recommended V1_INTEGRATION_PASS)

- CMP-050 INT-002 client `approve`/`reject` omit CMP-051 required `reason`. Stitch used checker `inject` with reason. Owner CMP-050.
- ADR-0001: published workflow compile-and-run is M05; M03 INT-002 stops at TenantServiceBinding publication.
- CMP-050/054 are not Fastify-mounted (host composition by design).
- REAL DEPARTMENT_API adapter not shipped; fail-closed verified.

## Explicit non-claims

- Not VERIFIED / not CERTIFIED / not `G3_INTEGRATION_VERIFIED`
- SF-M03-SEC and SF-M03-EVD not started
- M04 not started
- #59 and #60 were not merged
