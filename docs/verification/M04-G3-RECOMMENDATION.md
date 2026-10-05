# M04 G3 recommendation (independent evidence bind)

**Recommended gate: `G3_INTEGRATION` + `_` + `VERIFIED`**

Independent evidence verifier (SF-M04-EVD) bind of executed INT + SEC records. **Human/CI decides G3.** This record does **not** certify, merge, issue G3, issue G6, or mark CERTIFIED / RELEASE CERTIFIED. M05 remains **OFF**. Do not start M05.

| Field | Value |
|---|---|
| Module | M04 (Forms, rules, evidence, documents, AI Gateway; CMP-008/009/011/013/014/039; INT-011/013) |
| Task | SF-M04-EVD |
| Role | independent evidence verifier |
| Production base | `origin/main` `afc8e253` + `d4c566a4a18b1e01d9b0a1163f9d6adf` (merge [#78](https://github.com/dbn1972/serviceform-ai/pull/78)) |
| Recommended result | **`G3_INTEGRATION` + `_` + `VERIFIED`** |
| Human/CI decision | **required** (this agent does **not** issue the gate) |
| `gate_issued` / `gate_passed` / `gate_ready` / `human_gate_issued` | **false** |
| Self-certified | **false** |
| CERTIFIED / G6 / RELEASE CERTIFIED | **false** (`not_certified: true`, `g6_claimed: false`) |
| Production rewritten | **false** |
| M05 | **OFF** (not started) |

Unmerged drafts bound as **executed evidence only**, not production source of truth. Do **not** merge this PR, [#80](https://github.com/dbn1972/serviceform-ai/pull/80), or [#79](https://github.com/dbn1972/serviceform-ai/pull/79) on this recommendation alone. Do not cherry-pick verifier tests into `main`.

## Bound verifier results

| Gate | Source | Head SHA | Recommended result | Merged | Certified |
|---|---|---|---|---|---|
| V1 Integration | [#80](https://github.com/dbn1972/serviceform-ai/pull/80) | `3736c023` + `18bb89c6f89cff31e2afc966ab15e27b` | `V1_INTEGRATION` + `_` + `PASS` | **false** | **false** |
| V1 Security | [#79](https://github.com/dbn1972/serviceform-ai/pull/79) | `6c4b0a41` + `dfe77b694f4566dcdd903d5d49c7b337` | `V1_SECURITY` + `_` + `PASS` | **false** | **false** |

M04 production components already on SoT via host merge [#78](https://github.com/dbn1972/serviceform-ai/pull/78) / STITCH-B [#77](https://github.com/dbn1972/serviceform-ai/pull/77) (not treated as unmerged sibling code for this bind).

## Independent inspection (exact heads)

| Check | INT [#80](https://github.com/dbn1972/serviceform-ai/pull/80) | SEC [#79](https://github.com/dbn1972/serviceform-ai/pull/79) |
|---|---|---|
| PR state | **OPEN** draft; `mergedAt=null` | **OPEN** draft; `mergedAt=null` |
| Head OID | `3736c023` + `18bb89c6f89cff31e2afc966ab15e27b` | `6c4b0a41` + `dfe77b694f4566dcdd903d5d49c7b337` |
| Base OID | `afc8e253` + `d4c566a4a18b1e01d9b0a1163f9d6adf` | `afc8e253` + `d4c566a4a18b1e01d9b0a1163f9d6adf` |
| Diff vs production base | evidence + `tests/integration/m04/**` + INT handover only | evidence + `tests/security/m04/**` + SEC handover only |
| Production paths (`services/**`, `apps/**`, `contracts/**`, `db/migrations/**`, `packages/**`, `pnpm-lock.yaml`) | **NONE modified** | **NONE modified** |
| `production_code_modified` | **false** | **false** |
| Workflows on exact head | ci / security / developer-platform **SUCCESS** | ci / security / developer-platform **SUCCESS** |

## Executed facts independently confirmed

| Fact | INT (#80) | SEC (#79) |
|---|---|---|
| Production base | `afc8e253` + `d4c566a4…` | `afc8e253` + `d4c566a4…` |
| Evidence PR head | `3736c023` + `18bb89c6…` | `6c4b0a41` + `dfe77b69…` |
| Local / catalog stamp | `local-m04-int` @ `2026-10-05T03:49:26Z` | catalog `assessed_at=2026-10-05T03:49:30.000Z` |
| Suites / probes | **11/11** PASS; **420** tests; INT-011 **PASS**; INT-013 **PASS** | vitest **17/17**; LOGIN catalog **296/0** |
| `CROSS_TENANT_LEAKAGE` | **0** | **0** |
| Frozen contracts | **13/13 MATCH** | **13/13 MATCH** |
| Role / RLS probes | (INT host/RLS stitch) | SUPERUSER **0**; BYPASSRLS **0**; FORCE RLS 33+33; XCOMP **8** → `42501` |
| Envelope uniqueness | `state: READY`, `dispatched: false` | `state: READY`, `dispatched: false` |
| `certified` | **false** | **false** |

Independent EVD re-ran on production base `afc8e253…`: `contracts_lock_gate.py` **PASS** (13 FROZEN); `cg01_path_uniqueness_gate.py` **PASS**. Uniqueness compared keys on SF-M04-INT / SF-M04-SEC / SF-M04-EVD **task** envelopes remain `state: READY` / `dispatched: false`. Gate script was not weakened.

### GitHub Actions (exact evidence heads; SUCCESS)

| PR | Head | `ci` | `security` | `developer-platform` |
|---|---|---|---|---|
| #80 | `3736c023…` | [37261885573](https://github.com/dbn1972/serviceform-ai/actions/runs/37261885573) SUCCESS | [37261885628](https://github.com/dbn1972/serviceform-ai/actions/runs/37261885628) SUCCESS | [37261885583](https://github.com/dbn1972/serviceform-ai/actions/runs/37261885583) SUCCESS |
| #79 | `6c4b0a41…` | [37262246722](https://github.com/dbn1972/serviceform-ai/actions/runs/37262246722) SUCCESS | [37262246579](https://github.com/dbn1972/serviceform-ai/actions/runs/37262246579) SUCCESS | [37262246572](https://github.com/dbn1972/serviceform-ai/actions/runs/37262246572) SUCCESS |

Check-run rollups on those heads: **15/15 SUCCESS** each (ci + security + developer-platform jobs, including CodeQL). Corroborating SoT push on `afc8e253…`: ci [37258144686](https://github.com/dbn1972/serviceform-ai/actions/runs/37258144686), security [37258144700](https://github.com/dbn1972/serviceform-ai/actions/runs/37258144700), developer-platform [37258144667](https://github.com/dbn1972/serviceform-ai/actions/runs/37258144667) SUCCESS. GitHub SUCCESS is corroboration of repo gates on the bound heads; it is not a substitute for the local INT/SEC catalogs.

## SHA stamp map (authoritative bind)

| Role | SHA | Notes |
|---|---|---|
| Production base | `afc8e253` + `d4c566a4a18b1e01d9b0a1163f9d6adf` | Only production source of truth |
| INT evidence PR head | `3736c023` + `18bb89c6f89cff31e2afc966ab15e27b` | Authoritative INT GitHub CI head |
| INT local run | `local-m04-int` / `independent-m04-integration` | Catalog stamp on production base |
| SEC evidence PR head | `6c4b0a41` + `dfe77b694f4566dcdd903d5d49c7b337` | Authoritative SEC GitHub CI freeze |
| SEC evidence-doc stamp | `d2286fe2` + `bc6ed6b33853d7275a9bcd61dfe4579d` | Class E doc binding; ancestor of freeze; do not rewrite #79 |

## Residual disposition (non-blocking for recommended G3; not leakage)

| Residual | Class | Disposition | Leakage? |
|---|---|---|---|
| INT REAL/SANDBOX provider / OCR / storage / scanner / DigiLocker adapters absent; fail-closed in PRODUCTION verified | **D** | `NON_BLOCKING_FOR_M04_G3` | **no** |
| SF-CON-OUTBOX publisher `USING true` / `sf_app` INSERT templates (ADR-0006 #9) | **ACCEPTED_FROZEN_RESIDUAL** | `NON_BLOCKING_FOR_M04_G3` | **no** (not `CROSS_TENANT_LEAKAGE`) |
| CMP-014 empty-repository stub may 500 after authz on some GET mounts | **A** | `NON_BLOCKING_FOR_M04_G3` | **no** |
| SEC `EVIDENCE.md` / summary stamps older head `d2286fe2…` while immutable freeze is `6c4b0a41…` | **CLASS_E_EVIDENCE_HEAD_BINDING** | `NON_BLOCKING_FOR_M04_G3` | **no** (do **not** rewrite #79) |

No unresolved **blocking** residual for this recommendation.

## Explicit non-claims

- Not CERTIFIED, not RELEASE CERTIFIED, not G6
- This agent does **not** issue G3; recommendation only (`gate_issued: false`, `gate_passed: false`, `human_gate_issued: false`)
- Did not merge #79 or #80 or rewrite production
- Did not cherry-pick verifier tests into `main`
- Did not start M05
- Did not treat unmerged PRs as production SoT
- Envelope YAML remains `state: READY` / `dispatched: false` for SF-M04-INT / SF-M04-SEC / SF-M04-EVD **task** copies
- `cg01_path_uniqueness_gate.py` not weakened

Machine-readable companion: `orchestrator/handovers/SF-M04-GATE.yaml` (`recommended_gate` family `G3_INTEGRATION` / status `VERIFIED`, `gate_issued: false`, `certified: false`). Evidence index: `evidence/SF-M04-EVD/`.
