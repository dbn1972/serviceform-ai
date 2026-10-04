# M03 G3 recommendation (independent evidence bind)

**Recommended gate: `G3_INTEGRATION_VERIFIED`**

Independent evidence verifier (SF-M03-EVD) bind of executed INT + SEC records. **Human/CI decides G3.** This record does **not** certify, merge, issue G6, or mark CERTIFIED / RELEASE CERTIFIED. M02 G3 and M04 remain out of scope.

| Field | Value |
|---|---|
| Module | M03 (Catalogue, versioning, TenantServiceBinding, Studio, UX4G) |
| Task | SF-M03-EVD |
| Role | independent evidence verifier |
| Production SoT | `origin/main` `7424235592824d5ceda9dcac55380a78c05cb6c5` (merge [#57](https://github.com/dbn1972/serviceform-ai/pull/57)) |
| Recommended result | **`G3_INTEGRATION_VERIFIED`** |
| Human/CI decision | **required** (this agent does not issue the gate) |
| Self-certified | **false** |
| CERTIFIED / G6 / RELEASE CERTIFIED | **false** (`not_certified: true`) |
| Production rewritten | **false** |
| M02 G3 | **out of scope** |
| M04 | **not started** (blocked until M02 and M03 G3 independently) |

Unmerged drafts bound as **executed evidence only**, not production source of truth. Do not merge this PR, [#59](https://github.com/dbn1972/serviceform-ai/pull/59), [#60](https://github.com/dbn1972/serviceform-ai/pull/60), or [#61](https://github.com/dbn1972/serviceform-ai/pull/61) on this recommendation alone.

## Bound verifier results

| Gate | Source | Head SHA | Recommended result | Certified |
|---|---|---|---|---|
| V1 Integration | [#59](https://github.com/dbn1972/serviceform-ai/pull/59) | `facb0fe72aa674364f14a3f372591866929d54e7` | `V1_INTEGRATION_PASS` | **false** |
| V1 Security | [#61](https://github.com/dbn1972/serviceform-ai/pull/61) | `8c859f25113cef4590d79886c8a77e1e7e8e4b3d` | `V1_SECURITY_PASS` | **false** |
| CMP-001 test-only tx split | [#60](https://github.com/dbn1972/serviceform-ai/pull/60) | `4f784b936ab8e3bc1a5e43226ce9310269463299` | included in #59 INT rerun (test file only) | **false** |

## Executed facts independently confirmed

| Fact | INT (#59) | SEC (#61) |
|---|---|---|
| Production base | `7424235` | `7424235` |
| `CROSS_TENANT_LEAKAGE` | **0** (`evidence/SF-M03-INT/summary/cross-tenant.json`) | **0** (catalog 309 pass / 0 fail) |
| Frozen contracts | **13/13 MATCH** (`contracts_lock_gate.py`) | **13/13 MATCH** |
| CMP-001 envelope INT | **8/8** (`Tests  8 passed (8)`) | pin INSERT on **fresh** txn **`42501`** (`PUB.001.pin_insert_fresh_txn`) |
| Pin INSERT vs aborted txn | no `25P02` after #60 split | `42501` without requiring merged #60 |
| Production src / migrations / RLS / grants / contracts / lockfile | **untouched** (PR files: tests + evidence only, plus CMP-001 **test** file from #60) | **untouched** (tests + evidence only) |
| Envelope uniqueness | `state: READY`, `dispatched: false` | `state: READY`, `dispatched: false` |
| `certified` | **false**; `g3_integration_verified_claimed: false` | **false**; not G3/G6 |

### GitHub Actions (exact heads; 15/15 SUCCESS)

| PR | Head | `ci` | `security` | `developer-platform` |
|---|---|---|---|---|
| #59 | `facb0fe` | [37200362505](https://github.com/dbn1972/serviceform-ai/actions/runs/37200362505) SUCCESS | [37200362502](https://github.com/dbn1972/serviceform-ai/actions/runs/37200362502) SUCCESS | [37200362494](https://github.com/dbn1972/serviceform-ai/actions/runs/37200362494) SUCCESS |
| #61 | `8c859f2` | [37201419195](https://github.com/dbn1972/serviceform-ai/actions/runs/37201419195) SUCCESS | [37201419196](https://github.com/dbn1972/serviceform-ai/actions/runs/37201419196) SUCCESS | [37201419200](https://github.com/dbn1972/serviceform-ai/actions/runs/37201419200) SUCCESS |
| #60 | `4f784b9` | [37200105236](https://github.com/dbn1972/serviceform-ai/actions/runs/37200105236) SUCCESS | [37200105240](https://github.com/dbn1972/serviceform-ai/actions/runs/37200105240) SUCCESS | [37200105282](https://github.com/dbn1972/serviceform-ai/actions/runs/37200105282) SUCCESS |

Independent INT suites were executed locally as run id `local-m03-int-rerun` / job `independent-m03-integration` (timestamp `2026-10-04T11:54:50Z`) with `result: PASS`, `fail_count: 0`, 13/13 suites. Independent SEC vitest **11/11** and LOGIN catalog **309/0** at probe commit `1efeac0030bf86a0861661c5ddeb2ba3b909a580` (`assessed_at=2026-10-04T12:07:56.168Z`). GitHub SUCCESS on those PRs corroborates repo quality/security/developer-platform gates on the bound heads; it is not a substitute for the local INT/SEC catalogs.

## SHA stamp map (authoritative bind)

| Role | SHA | Notes |
|---|---|---|
| Production SoT | `7424235592824d5ceda9dcac55380a78c05cb6c5` | Only production source of truth |
| INT evidence PR head | `facb0fe72aa674364f14a3f372591866929d54e7` | Includes evidence docs after rerun |
| INT local catalog stamp | `9a782b8a6ea4b03aad7ccd31b246231ab2c7ea24` | SHA when suites ran (includes #60 test split) |
| CMP-001 test-only split | `4f784b936ab8e3bc1a5e43226ce9310269463299` | `privilege-boundary.int.test.ts` + evidence; no `src/**` |
| SEC probe (tests) | `1efeac0030bf86a0861661c5ddeb2ba3b909a580` | Catalog/vitest stamp |
| SEC evidence bind | `60b2995acf2505dc3c0c7df63850b42ca42b5c50` | Logs/summaries |
| SEC PR head | `8c859f25113cef4590d79886c8a77e1e7e8e4b3d` | Prettier + eslint on **tests/security/m03** only |

Documented limitation (does not fail this recommendation): INT `summary.json` stamps `commit_sha=9a782b8…`; SEC catalog stamps `tip=1efeac0…`. Authoritative PR heads for GitHub CI are `facb0fe` and `8c859f2`. Later SEC commits are format/lint on verifier tests, not production.

## #60 test-only split

[#60](https://github.com/dbn1972/serviceform-ai/pull/60) splits CMP-001 privilege INT into separate transactions so pin-guard INSERT is asserted as **`42501`** instead of aborted-transaction **`25P02`**. File: `services/cmp-001-catalogue/test/integration/privilege-boundary.int.test.ts`. Included on #59 INT rerun. **No** CMP-001 production/src/migrations/RLS/grant change. Not merged.

## Residuals (non-blocking for recommended G3; not leakage)

1. ADR-0006 #9 / SF-CON-OUTBOX: frozen `USING true` / `sf_app` INSERT templates. Counted residual, **not** `CROSS_TENANT_LEAKAGE`. CCR required to change.
2. CMP-050 INT-002 client `approve`/`reject` omit CMP-051 required `reason` (INT residual; stitch used checker inject).
3. ADR-0001: published workflow compile-and-run is M05; M03 INT-002 stops at TenantServiceBinding publication.
4. CMP-050/054 not Fastify-mounted (host composition by design). REAL DEPARTMENT_API adapter not shipped; fail-closed verified (INT-013).
5. Unmerged drafts: verifier tests/evidence are not on `main`. Human/CI may require merge of INT/SEC test assets before treating G3 as issued.

## Explicit non-claims

- Not CERTIFIED, not RELEASE CERTIFIED, not G6
- This agent does **not** issue G3; recommendation only
- Did not merge #59/#60/#61 or rewrite production
- Did not start M04
- Did not assess M02 G3
- Envelope YAML remains `state: READY` / `dispatched: false`
- `cg01_path_uniqueness_gate.py` not weakened

Machine-readable companion: `orchestrator/handovers/M03-GATE.yaml` (`recommended_gate: G3_INTEGRATION_VERIFIED`, `gate_issued: false`, `certified: false`). Evidence index: `evidence/SF-M03-EVD/`.
