# SF-M03-SEC independent security evidence

**Not CERTIFIED. Not G3. Not G6. Not RELEASE CERTIFIED.**  
Independent verifier recommendation only: **`V1_SECURITY_PASS`**.

## Identity

| Field | Value |
| --- | --- |
| Task | SF-M03-SEC |
| Role | independent security verifier (publish/admin/tenant) |
| Production base | `origin/main` `7424235592824d5ceda9dcac55380a78c05cb6c5` (merge #57) |
| Probe commit (tests) | `1efeac0030bf86a0861661c5ddeb2ba3b909a580` |
| Components | CMP-001, CMP-033, CMP-034, CMP-050, CMP-051, CMP-052, CMP-053 |
| INT | INT-002 (Studio/publish path observed at BFF/host), INT-011 (tenant isolation) |
| Unmerged siblings | #59 / #60 **not** used as production source of truth; **not merged** |

## Executed results

| Check | Result |
| --- | --- |
| Independent vitest (`tests/security/m03`) | 3 files, **11/11 pass** |
| LOGIN-role catalog | **309 pass / 0 fail** |
| `CROSS_TENANT_LEAKAGE` | **0** |
| Forged / client-controlled tenant headers | HTTP 403 `SF-TEN-002`; canary absent from bodies |
| INT-011 RLS wrong-tenant SELECT | 0 rows (001/033/034/051/052/053) |
| Cross-component SQL (LOGIN SELECT peer schema) | `42501` |
| CMP-001 pin INSERT on **fresh** transaction | **`42501`** (not `25P02`) |
| Published metadata / binding / approved request mutation | `P0001` |
| Offering version UPDATE | `42501` |
| Runtime roles SUPERUSER / BYPASSRLS / LOGIN | all runtime group roles NOLOGIN, no BYPASSRLS |
| Studio (CMP-050) on Fastify host | **not registered** |
| UX4G (CMP-054) as API plugin | **no Fastify plugin** |
| Frozen contracts | **13/13 MATCH** (`contracts_lock_gate` PASS) |
| Path uniqueness envelope | `state: READY`, `dispatched: false` (gate PASS) |
| Write scope vs envelope | PASS (`tests/security/m03/**`, `evidence/**` only) |
| Production / contracts / migrations / grants / RLS | **untouched** |

## Explicit residuals (not leakage)

- SF-CON-OUTBOX publisher `USING true` and `sf_app` INSERT on outbox/inbox templates remain frozen (ADR-0006 #9). Counted as residual, **not** `CROSS_TENANT_LEAKAGE`.
- CMP-001 pin-guard `42501` was measured on a **new** transaction so an aborted prior statement cannot surface as `25P02`. #60's test-only split was **not** required for this probe and was **not** merged.

## Handover uniqueness

`orchestrator/handovers/SF-M03-SEC.yaml` and `orchestrator/tasks/SF-M03-SEC.yaml` left at **READY / dispatched false**. Gate `cg01_path_uniqueness_gate.py` was not weakened.

## Recommendation

**`V1_SECURITY_PASS`** from executed evidence only.  
Do **not** start SF-M03-EVD as CERTIFIED. Human/CI gate remains required. `certified: false`.
