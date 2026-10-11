# SF-M02-INT — independent integration evidence

**Recommended result: `V1_INTEGRATION_PASS`** (recommendation only; no waiver of residuals)  
**`CROSS_TENANT_LEAKAGE=0`**  
**Frozen contracts 13/13 MATCH** (`python3 scripts/gates/contracts_lock_gate.py`)  
**Not CERTIFIED. Does not claim `G3_INTEGRATION_VERIFIED`. Not G6 / RELEASE CERTIFIED.**  
Envelope YAML remains **`state: READY` / `dispatched: false`**. Uniqueness gate was not weakened.

Independent integration stitcher. Frozen contracts and production domain code were not modified. `services/**`, `apps/**`, `contracts/**`, migrations, RLS, grants, OPA, and `pnpm-lock.yaml` were not edited.

| Field | Value |
|---|---|
| Task | SF-M02-INT |
| Human authorizer | Debabrata Nayak |
| Production SoT | `origin/main` @ `d2530008bdc04ee941ff8a16535168791a3b804f` (merge #63) |
| Verifier / test execution SHA | `5e7d1cff40b6b5c444ae2ea58f8ba2b968cc0b91` |
| Evidence branch | `cursor/m02-int-verify-5e33` |
| Draft PR | (this PR; do not merge unless separately authorized) |
| Command | `DATABASE_URL=postgres://…/serviceform_test bash tests/integration/m02/run.sh` |
| Independent run id | `local-m02-int` / job `independent-m02-integration` |
| PostgreSQL | 16.15 (local cluster, SIMULATED/LOCAL connectors) |
| Frozen contracts | 13/13 MATCH (`contracts_lock_gate.py`) |
| `CROSS_TENANT_LEAKAGE` | **0** |

## Executed suites (this verifier)

| Suite | Result | Notes |
|---|---|---|
| Frozen contracts lock | PASS | 13/13 MATCH |
| Independent INT-013 REAL/SANDBOX/SIMULATED matrix | PASS | 4 tests; CMP-004/005 fail-closed; LOCAL/CI SIMULATED allowed |
| Independent INT-011 host `x-tenant-id` | PASS | 3 tests; SF-TEN-002, no canary; SF-AUTH-001 / SF-AUTH-002 |
| Host `composition-m02.test.ts` | PASS | 4 tests |
| CMP-004 `test:integration` | PASS | 4 tests |
| CMP-005 `test:integration` | PASS | 7 tests |
| Independent INT-001 HTTP stitch (004 session → 005 profile) | PASS | OTP + officer IdP tenant from assertion; forged header SF-TEN-002; T2 no T1 claims; idempotent upsert; consent/authz deny SF-AUTH-002 |
| Independent INT-011 LOGIN RLS catalog | PASS | `CROSS_TENANT_LEAKAGE=0`; non-owner; no SUPERUSER; no BYPASSRLS; peer DML deny; wrong-tenant INSERT `42501` in a fresh transaction |
| CMP-004/005 unit (INT-013 modes) | PASS | 16 + 18 tests |

Machine summary: `evidence/SF-M02-INT/summary.json` (`result: PASS`, `fail_count: 0`, suites 7/7). RLS: `evidence/SF-M02-INT/summary/cross-tenant.json`. Mirror: `evidence/integration/m02/`.

First independent-int attempt failed two **class A** harness assertions (non-UUID Fastify `req.id` vs frozen error-response; envelope leftover `officer_principal` PK). Production was **not** patched. Fixes are in this branch’s test files only.

## Connector modes (INT-013)

Environment for this run: **LOCAL/CI SIMULATED**. PRODUCTION SIMULATED refused. REAL/SANDBOX adapters are not shipped and fail closed.

## Residuals (non-blocking for recommended V1_INTEGRATION_PASS)

- Citizen OTP sessions are platform-scoped (`tenant_id` null). CMP-005 requires tenant context, so citizen-token profile GET is `SF-TEN-001` (401). Tenant-scoped profile/DigiLocker import in this stitch is officer-session-derived (IdP assertion tenant). Forged `x-tenant-id` still `SF-TEN-002`.
- Consent is a CMP-030 port. Stitch used the AllowConsent double; deny-closed `SF-AUTH-002` with no claim leakage was executed.
- REAL OTP / IdP / DigiLocker adapters are not shipped; fail-closed is verified, not live provider behavior.

## Explicit non-claims

- Not VERIFIED / not CERTIFIED / not `G3_INTEGRATION_VERIFIED` / not G6 / not RELEASE CERTIFIED
- SF-M02-SEC, SF-M02-EVD, and M04 were not started
- This evidence PR must not be merged unless separately authorized
