# M03 G3 module-exit gate record

**Issued gate: `G3_INTEGRATION_VERIFIED` (M03 module-exit only)**

Human/CI issued this gate after independent INT + SEC evidence bind. This pull request **records** issuance. The recording agent does **not** self-certify. **Not CERTIFIED. Not RELEASE CERTIFIED. Not G6.** M04 remains **BLOCKED** because M02 G3 is still pending. Do not start M02 INT/SEC/EVD from this record.

| Field | Value |
|---|---|
| Module | M03 (Catalogue, versioning, TenantServiceBinding, Studio, UX4G) |
| Exit gate | **`G3_INTEGRATION_VERIFIED`** (module-exit) |
| `gate_issued` / `gate_ready` / `gate_passed` | **true** (human/CI) |
| Production SoT | `origin/main` `7424235592824d5ceda9dcac55380a78c05cb6c5` (merge [#57](https://github.com/dbn1972/serviceform-ai/pull/57)) |
| #60 PR head | `4f784b936ab8e3bc1a5e43226ce9310269463299` |
| #60 landed merge SHA | `bd5799b5a784e0e7e6360040cba1c2eda1522c6d` |
| Self-certified | **false** |
| CERTIFIED / G6 / RELEASE CERTIFIED | **false** (`not_certified: true`, `g6_claimed: false`) |
| Production rewritten | **false** (#60 is test-only) |
| M02 G3 | **pending** (out of scope; do not start M02 INT/SEC/EVD) |
| M04 | **BLOCKED** until M02 and M03 G3 independently |

[#59](https://github.com/dbn1972/serviceform-ai/pull/59) and [#61](https://github.com/dbn1972/serviceform-ai/pull/61) remain **unmerged** immutable independent verifier evidence references. Do not merge them as part of this gate record. Draft [#62](https://github.com/dbn1972/serviceform-ai/pull/62) is superseded (recommendation-only; this PR is the issuance record).

## Bound verifier results

| Gate | Source | Head SHA | Result | Merged | Certified |
|---|---|---|---|---|---|
| V1 Integration | [#59](https://github.com/dbn1972/serviceform-ai/pull/59) | `facb0fe72aa674364f14a3f372591866929d54e7` | `V1_INTEGRATION_PASS` | **false** (evidence ref) | **false** |
| V1 Security | [#61](https://github.com/dbn1972/serviceform-ai/pull/61) | `8c859f25113cef4590d79886c8a77e1e7e8e4b3d` | `V1_SECURITY_PASS` | **false** (evidence ref) | **false** |
| CMP-001 test-only tx split | [#60](https://github.com/dbn1972/serviceform-ai/pull/60) | `4f784b936ab8e3bc1a5e43226ce9310269463299` | included in #59 INT rerun | **true** @ `bd5799b` | **false** |

## Executed facts independently confirmed

| Fact | INT (#59) | SEC (#61) |
|---|---|---|
| Production base | `7424235` | `7424235` |
| `CROSS_TENANT_LEAKAGE` | **0** | **0** (catalog 309 pass / 0 fail) |
| Frozen contracts | **13/13 MATCH** | **13/13 MATCH** |
| CMP-001 envelope INT | **8/8** | pin INSERT on **fresh** txn **`42501`** |
| Pin INSERT vs aborted txn | no `25P02` after #60 split | `42501` without requiring merged #60 |
| Production src / migrations / RLS / grants / contracts / lockfile | **untouched** except CMP-001 **test** file landed via #60 | **untouched** |
| Envelope uniqueness | `state: READY`, `dispatched: false` | `state: READY`, `dispatched: false` |
| `certified` | **false** | **false** |

### GitHub Actions (exact heads; 15/15 SUCCESS)

| PR | Head | `ci` | `security` | `developer-platform` |
|---|---|---|---|---|
| #59 | `facb0fe` | [37200362505](https://github.com/dbn1972/serviceform-ai/actions/runs/37200362505) SUCCESS | [37200362502](https://github.com/dbn1972/serviceform-ai/actions/runs/37200362502) SUCCESS | [37200362494](https://github.com/dbn1972/serviceform-ai/actions/runs/37200362494) SUCCESS |
| #61 | `8c859f2` | [37201419195](https://github.com/dbn1972/serviceform-ai/actions/runs/37201419195) SUCCESS | [37201419196](https://github.com/dbn1972/serviceform-ai/actions/runs/37201419196) SUCCESS | [37201419200](https://github.com/dbn1972/serviceform-ai/actions/runs/37201419200) SUCCESS |
| #60 | `4f784b9` | [37200105236](https://github.com/dbn1972/serviceform-ai/actions/runs/37200105236) SUCCESS | [37200105240](https://github.com/dbn1972/serviceform-ai/actions/runs/37200105240) SUCCESS | [37200105282](https://github.com/dbn1972/serviceform-ai/actions/runs/37200105282) SUCCESS |

Independent INT suites were executed locally as run id `local-m03-int-rerun` / job `independent-m03-integration` (timestamp `2026-10-04T11:54:50Z`) with `result: PASS`, `fail_count: 0`, 13/13 suites. Independent SEC vitest **11/11** and LOGIN catalog **309/0** at probe commit `1efeac0030bf86a0861661c5ddeb2ba3b909a580` (`assessed_at=2026-10-04T12:07:56.168Z`). GitHub SUCCESS on those PRs corroborates repo quality/security/developer-platform gates on the bound heads.

## SHA stamp map

| Role | SHA | Notes |
|---|---|---|
| Production SoT | `7424235592824d5ceda9dcac55380a78c05cb6c5` | Production source of truth |
| INT evidence PR head | `facb0fe72aa674364f14a3f372591866929d54e7` | Unmerged immutable ref |
| INT local catalog stamp | `9a782b8a6ea4b03aad7ccd31b246231ab2c7ea24` | SHA when suites ran (includes #60 test split) |
| CMP-001 test-only split PR head | `4f784b936ab8e3bc1a5e43226ce9310269463299` | Test + evidence; no `src/**` |
| #60 landed merge | `bd5799b5a784e0e7e6360040cba1c2eda1522c6d` | Merge of #60 into `main` |
| SEC probe (tests) | `1efeac0030bf86a0861661c5ddeb2ba3b909a580` | Catalog/vitest stamp |
| SEC PR head | `8c859f25113cef4590d79886c8a77e1e7e8e4b3d` | Unmerged immutable ref |

Documented limitation (does not fail this gate): INT `summary.json` stamps `commit_sha=9a782b8…`; SEC catalog stamps `tip=1efeac0…`. Authoritative PR heads for GitHub CI are `facb0fe` and `8c859f2`.

## #60 test-only split (landed)

[#60](https://github.com/dbn1972/serviceform-ai/pull/60) splits CMP-001 privilege INT into separate transactions so pin-guard INSERT is asserted as **`42501`** instead of aborted-transaction **`25P02`**. File: `services/cmp-001-catalogue/test/integration/privilege-boundary.int.test.ts`. Included on #59 INT rerun. **No** CMP-001 production/src/migrations/RLS/grant change. Landed on `main` at `bd5799b5a784e0e7e6360040cba1c2eda1522c6d`.

## Residuals (non-blocking for issued G3; not leakage)

1. ADR-0006 #9 / SF-CON-OUTBOX: frozen `USING true` / `sf_app` INSERT templates. Counted residual, **not** `CROSS_TENANT_LEAKAGE`. CCR required to change.
2. CMP-050 INT-002 client `approve`/`reject` omit CMP-051 required `reason` (INT residual; stitch used checker inject).
3. ADR-0001: published workflow compile-and-run is M05; M03 INT-002 stops at TenantServiceBinding publication.
4. CMP-050/054 not Fastify-mounted (host composition by design). REAL DEPARTMENT_API adapter not shipped; fail-closed verified (INT-013).
5. INT/SEC verifier test assets remain on unmerged #59/#61; they are evidence references, not production SoT.

## Explicit non-claims

- Not CERTIFIED, not RELEASE CERTIFIED, not G6
- Recording agent does **not** self-certify (`self_certified: false`)
- Did not merge #59/#61 or rewrite production
- Did not start M04
- Did not assess or start M02 G3 / M02 INT/SEC/EVD
- Envelope YAML remains `state: READY` / `dispatched: false` for SF-M03-INT / SF-M03-SEC / SF-M03-EVD **task** envelopes
- `cg01_path_uniqueness_gate.py` not weakened

Machine-readable companion: `orchestrator/handovers/M03-GATE.yaml` (`recommended_gate: G3_INTEGRATION_VERIFIED`, `gate_issued: true`, `certified: false`). Evidence index: `evidence/SF-M03-EVD/`.
