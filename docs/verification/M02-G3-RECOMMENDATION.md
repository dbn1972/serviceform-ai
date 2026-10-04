# M02 G3 recommendation (independent evidence bind)

**Recommended gate: `G3_INTEGRATION_VERIFIED`**

Independent evidence verifier (SF-M02-EVD) bind of executed INT + SEC records. **Human/CI decides G3.** This record does **not** certify, merge, issue G3, issue G6, or mark CERTIFIED / RELEASE CERTIFIED. M04 remains **BLOCKED**. Do not start M04.

| Field | Value |
|---|---|
| Module | M02 (Identity and Citizen Profile; CMP-004, CMP-005; INT-001) |
| Task | SF-M02-EVD |
| Role | independent evidence verifier |
| Production SoT | `origin/main` `d2530008bdc04ee941ff8a16535168791a3b804f` (merge [#63](https://github.com/dbn1972/serviceform-ai/pull/63)) |
| Recommended result | **`G3_INTEGRATION_VERIFIED`** |
| Human/CI decision | **required** (this agent does **not** issue the gate) |
| `gate_issued` / `gate_passed` | **false** |
| Self-certified | **false** |
| CERTIFIED / G6 / RELEASE CERTIFIED | **false** (`not_certified: true`, `g6_claimed: false`) |
| Production rewritten | **false** |
| M03 G3 | **already issued** on this SoT (out of this agent’s issuance role) |
| M04 | **not started** (blocked until **issued** M02 G3 **and** existing M03 G3) |

Unmerged drafts bound as **executed evidence only**, not production source of truth. Do **not** merge this PR, [#64](https://github.com/dbn1972/serviceform-ai/pull/64), or [#65](https://github.com/dbn1972/serviceform-ai/pull/65) on this recommendation alone.

## Bound verifier results

| Gate | Source | Head SHA | Recommended result | Merged | Certified |
|---|---|---|---|---|---|
| V1 Integration | [#64](https://github.com/dbn1972/serviceform-ai/pull/64) | `adaed2f17143367d687f501e333aa6f49476804d` | `V1_INTEGRATION_PASS` | **false** | **false** |
| V1 Security | [#65](https://github.com/dbn1972/serviceform-ai/pull/65) | `428124b3772d47d647207da269a28e7f0953f375` | `V1_SECURITY_PASS` | **false** | **false** |

M02 production components already on SoT (not treated as unmerged sibling code): CMP-004 [#48](https://github.com/dbn1972/serviceform-ai/pull/48), CMP-005 [#47](https://github.com/dbn1972/serviceform-ai/pull/47), host mount SF-M02-003 [#54](https://github.com/dbn1972/serviceform-ai/pull/54).

## Executed facts independently confirmed

| Fact | INT (#64) | SEC (#65) |
|---|---|---|
| Production base | `d2530008bdc04ee941ff8a16535168791a3b804f` | `d2530008bdc04ee941ff8a16535168791a3b804f` |
| Evidence PR head | `adaed2f17143367d687f501e333aa6f49476804d` | `428124b3772d47d647207da269a28e7f0953f375` |
| Local catalog / probe stamp | `5e7d1cff40b6b5c444ae2ea58f8ba2b968cc0b91` (`local-m02-int`) | `1baa64c77988b99740ccb0f1bab660209583635e` |
| Suites | **7/7** PASS (`fail_count: 0`) | vitest **11/11**; LOGIN catalog **108/0** |
| `CROSS_TENANT_LEAKAGE` | **0** | **0** |
| Frozen contracts | **13/13 MATCH** (`contracts_lock_gate.py`) | **13/13 MATCH** |
| Production src / migrations / RLS / grants / contracts / lockfile | **untouched** (PR files: tests + evidence only) | **untouched** (tests + evidence; handover comments only) |
| Envelope uniqueness | `state: READY`, `dispatched: false` | `state: READY`, `dispatched: false` |
| `certified` | **false**; `g3_integration_verified_claimed: false` | **false**; not G3/G6 |

Independent EVD re-ran on production SoT `d2530008…`: `contracts_lock_gate.py` **PASS** (13 FROZEN); `cg01_path_uniqueness_gate.py` **PASS**. Uniqueness compared keys on SF-M02-INT / SF-M02-SEC / SF-M02-EVD **task** envelopes remain `state: READY` / `dispatched: false`. Gate script was not weakened.

### GitHub Actions (exact evidence heads; SUCCESS)

| PR | Head | `ci` | `security` | `developer-platform` |
|---|---|---|---|---|
| #64 | `adaed2f` | [37206363192](https://github.com/dbn1972/serviceform-ai/actions/runs/37206363192) SUCCESS | [37206363200](https://github.com/dbn1972/serviceform-ai/actions/runs/37206363200) SUCCESS | [37206363195](https://github.com/dbn1972/serviceform-ai/actions/runs/37206363195) SUCCESS |
| #65 | `428124b` | [37206523890](https://github.com/dbn1972/serviceform-ai/actions/runs/37206523890) SUCCESS | [37206523948](https://github.com/dbn1972/serviceform-ai/actions/runs/37206523948) SUCCESS | [37206523895](https://github.com/dbn1972/serviceform-ai/actions/runs/37206523895) SUCCESS |

Check-run rollups on those heads: **15/15 SUCCESS** each (ci + security + developer-platform jobs, including CodeQL). Corroborating SoT push on `d2530008…`: ci [37205151583](https://github.com/dbn1972/serviceform-ai/actions/runs/37205151583), security [37205151576](https://github.com/dbn1972/serviceform-ai/actions/runs/37205151576), developer-platform [37205151582](https://github.com/dbn1972/serviceform-ai/actions/runs/37205151582) SUCCESS. GitHub SUCCESS is corroboration of repo gates on the bound heads; it is not a substitute for the local INT/SEC catalogs.

INT local run id `local-m02-int` / job `independent-m02-integration` (`timestamp=2026-10-04T13:37:44Z`, `result: PASS`). SEC catalog `assessed_at=2026-10-04T13:36:01.532Z`.

## SHA stamp map (authoritative bind)

| Role | SHA | Notes |
|---|---|---|
| Production SoT | `d2530008bdc04ee941ff8a16535168791a3b804f` | Only production source of truth |
| INT evidence PR head | `adaed2f17143367d687f501e333aa6f49476804d` | Authoritative INT GitHub CI head |
| INT local catalog stamp | `5e7d1cff40b6b5c444ae2ea58f8ba2b968cc0b91` | SHA when suites ran (class-A harness isolation) |
| SEC probe (tests) | `1baa64c77988b99740ccb0f1bab660209583635e` | Catalog/vitest stamp |
| SEC evidence PR head | `428124b3772d47d647207da269a28e7f0953f375` | Authoritative SEC GitHub CI head (prettier + SAST-clean probes) |

Documented limitation (does **not** fail this recommendation): INT `summary.json` stamps `commit_sha=5e7d1cf…`; SEC catalog stamps `tip=d2530008…` / `probe_commit=1baa64c…`. Authoritative PR heads for GitHub CI are `adaed2f` and `428124b`. Later INT/SEC commits are evidence docs or verifier-test hygiene, not production.

## Residuals (non-blocking for recommended G3; not leakage)

No unresolved **blocking** residual for this recommendation.

1. ADR-0006 #9 / SF-CON-OUTBOX: frozen `USING true` / `sf_app` INSERT templates. Counted residual, **not** `CROSS_TENANT_LEAKAGE`. CCR required to change.
2. Citizen OTP sessions are platform-scoped (`tenant_id` null); CMP-005 profile GET with citizen token is `SF-TEN-001`. Tenant-scoped profile/DigiLocker stitch is officer-session-derived. Forged `x-tenant-id` still `SF-TEN-002`.
3. Consent is a CMP-030 port; INT used AllowConsent double; deny-closed `SF-AUTH-002` executed. REAL OTP / IdP / DigiLocker adapters not shipped; fail-closed verified (INT-013), not live provider behavior.
4. CMP-004 CITIZEN_PRIVATE / PLATFORM_OPERATIONAL tables documented `rls: NOT_APPLICABLE` (no `tenant_id`); isolation is citizen_id keyed; peer-component SELECT remains `42501`. Not counted as leakage.
5. Unmerged #64/#65 verifier tests/evidence are not on `main`. Human/CI may require those assets before treating G3 as **issued**.
6. R-BRANCH-PROT remains an OPS accepted residual from M01 G4 (not leakage).
7. Standing: not CERTIFIED / not RELEASE CERTIFIED / not G6.

## Explicit non-claims

- Not CERTIFIED, not RELEASE CERTIFIED, not G6
- This agent does **not** issue G3; recommendation only (`gate_issued: false`, `gate_passed: false`)
- Did not merge #64 or #65 or rewrite production
- Did not start M04
- Did not treat unmerged PRs as production SoT
- Envelope YAML remains `state: READY` / `dispatched: false` for SF-M02-INT / SF-M02-SEC / SF-M02-EVD **task** copies
- `cg01_path_uniqueness_gate.py` not weakened

Machine-readable companion: `orchestrator/handovers/M02-GATE.yaml` (`recommended_gate: G3_INTEGRATION_VERIFIED`, `gate_issued: false`, `certified: false`). Evidence index: `evidence/SF-M02-EVD/`.
