# M02 G3 module-exit gate record

**Issued gate: `G3_INTEGRATION_VERIFIED` (M02 module-exit only)**

Human/CI issued this gate after independent INT + SEC evidence bind (EVD recommendation [#66](https://github.com/dbn1972/serviceform-ai/pull/66)). This pull request **records** issuance. The recording agent does **not** self-certify. **Not CERTIFIED. Not RELEASE CERTIFIED. Not G6.** M03 is already `G3_INTEGRATION_VERIFIED` on this production SoT. **M04 remains OFF** (eligible later under ADR-0001 only after separate human authorization). Do **not** start M04.

| Field | Value |
|---|---|
| Module | M02 (Identity and Citizen Profile; CMP-004, CMP-005; INT-001) |
| Exit gate | **`G3_INTEGRATION_VERIFIED`** (module-exit) |
| `gate_issued` / `gate_ready` / `gate_passed` | **true** (human/CI) |
| Production SoT | `origin/main` `d2530008bdc04ee941ff8a16535168791a3b804f` (merge [#63](https://github.com/dbn1972/serviceform-ai/pull/63)) |
| EVD recommendation head | `e672263f511c9d675f8dfbc8b576b82b4ff4dfaa` ([#66](https://github.com/dbn1972/serviceform-ai/pull/66); `gate_issued: false`; do not merge) |
| Self-certified | **false** |
| CERTIFIED / G6 / RELEASE CERTIFIED | **false** (`not_certified: true`, `g6_claimed: false`) |
| Production rewritten | **false** |
| M03 G3 | **already issued** on this SoT |
| M04 | **OFF** until separate human authorization (ADR-0001) |

[#64](https://github.com/dbn1972/serviceform-ai/pull/64) and [#65](https://github.com/dbn1972/serviceform-ai/pull/65) remain **unmerged** immutable independent verifier evidence references. Do not merge them as part of this gate record. Draft [#66](https://github.com/dbn1972/serviceform-ai/pull/66) is superseded (recommendation-only; this PR is the issuance record).

## Bound verifier results

| Gate | Source | Head SHA | Result | Merged | Certified |
|---|---|---|---|---|---|
| V1 Integration | [#64](https://github.com/dbn1972/serviceform-ai/pull/64) | `adaed2f17143367d687f501e333aa6f49476804d` | `V1_INTEGRATION_PASS` | **false** (evidence ref) | **false** |
| V1 Security | [#65](https://github.com/dbn1972/serviceform-ai/pull/65) | `428124b3772d47d647207da269a28e7f0953f375` | `V1_SECURITY_PASS` | **false** (evidence ref) | **false** |
| EVD recommendation | [#66](https://github.com/dbn1972/serviceform-ai/pull/66) | `e672263f511c9d675f8dfbc8b576b82b4ff4dfaa` | recommended G3 (`gate_issued: false`) | **false** (superseded) | **false** |

M02 production components already on SoT (not treated as unmerged sibling code): CMP-004 [#48](https://github.com/dbn1972/serviceform-ai/pull/48), CMP-005 [#47](https://github.com/dbn1972/serviceform-ai/pull/47), host mount SF-M02-003 [#54](https://github.com/dbn1972/serviceform-ai/pull/54).

## Executed facts independently confirmed

| Fact | INT (#64) | SEC (#65) |
|---|---|---|
| Production base | `d2530008bdc04ee941ff8a16535168791a3b804f` | `d2530008bdc04ee941ff8a16535168791a3b804f` |
| Evidence PR head | `adaed2f17143367d687f501e333aa6f49476804d` | `428124b3772d47d647207da269a28e7f0953f375` |
| Local catalog / probe stamp | `5e7d1cff40b6b5c444ae2ea58f8ba2b968cc0b91` (`local-m02-int`) | `1baa64c77988b99740ccb0f1bab660209583635e` |
| Suites | **7/7** PASS (`fail_count: 0`) | vitest **11/11**; LOGIN catalog **108/0** |
| `CROSS_TENANT_LEAKAGE` | **0** | **0** |
| Frozen contracts | **13/13 MATCH** | **13/13 MATCH** |
| Production src / migrations / RLS / grants / contracts / lockfile | **untouched** | **untouched** |
| Envelope uniqueness | `state: READY`, `dispatched: false` | `state: READY`, `dispatched: false` |
| `certified` | **false** | **false** |

Independent EVD re-ran on production SoT `d2530008…`: `contracts_lock_gate.py` **PASS** (13 FROZEN); `cg01_path_uniqueness_gate.py` **PASS**. Uniqueness compared keys on SF-M02-INT / SF-M02-SEC / SF-M02-EVD **task** envelopes remain `state: READY` / `dispatched: false`. Gate script was not weakened.

### GitHub Actions (exact evidence heads; 15/15 SUCCESS)

| PR | Head | `ci` | `security` | `developer-platform` |
|---|---|---|---|---|
| #64 | `adaed2f` | [37206363192](https://github.com/dbn1972/serviceform-ai/actions/runs/37206363192) SUCCESS | [37206363200](https://github.com/dbn1972/serviceform-ai/actions/runs/37206363200) SUCCESS | [37206363195](https://github.com/dbn1972/serviceform-ai/actions/runs/37206363195) SUCCESS |
| #65 | `428124b` | [37206523890](https://github.com/dbn1972/serviceform-ai/actions/runs/37206523890) SUCCESS | [37206523948](https://github.com/dbn1972/serviceform-ai/actions/runs/37206523948) SUCCESS | [37206523895](https://github.com/dbn1972/serviceform-ai/actions/runs/37206523895) SUCCESS |

Corroborating SoT push on `d2530008…`: ci [37205151583](https://github.com/dbn1972/serviceform-ai/actions/runs/37205151583), security [37205151576](https://github.com/dbn1972/serviceform-ai/actions/runs/37205151576), developer-platform [37205151582](https://github.com/dbn1972/serviceform-ai/actions/runs/37205151582) SUCCESS. GitHub SUCCESS is corroboration of repo gates on the bound heads; it is not a substitute for the local INT/SEC catalogs.

INT local run id `local-m02-int` / job `independent-m02-integration` (`timestamp=2026-10-04T13:37:44Z`, `result: PASS`). SEC catalog `assessed_at=2026-10-04T13:36:01.532Z`.

## SHA stamp map

| Role | SHA | Notes |
|---|---|---|
| Production SoT | `d2530008bdc04ee941ff8a16535168791a3b804f` | Only production source of truth |
| INT evidence PR head | `adaed2f17143367d687f501e333aa6f49476804d` | Unmerged immutable ref |
| INT local catalog stamp | `5e7d1cff40b6b5c444ae2ea58f8ba2b968cc0b91` | SHA when suites ran |
| SEC probe (tests) | `1baa64c77988b99740ccb0f1bab660209583635e` | Catalog/vitest stamp |
| SEC evidence PR head | `428124b3772d47d647207da269a28e7f0953f375` | Unmerged immutable ref |
| EVD recommendation PR head | `e672263f511c9d675f8dfbc8b576b82b4ff4dfaa` | Unmerged; `gate_issued: false`; superseded |

Documented limitation (does not fail this gate): INT `summary.json` stamps `commit_sha=5e7d1cf…`; SEC catalog stamps `tip=d2530008…` / `probe_commit=1baa64c…`. Authoritative PR heads for GitHub CI are `adaed2f` and `428124b`.

## Residuals (non-blocking for issued G3; not leakage)

No unresolved **blocking** residual for issued G3.

1. ADR-0006 #9 / SF-CON-OUTBOX: frozen `USING true` / `sf_app` INSERT templates. Counted residual, **not** `CROSS_TENANT_LEAKAGE`. CCR required to change.
2. Citizen OTP sessions are platform-scoped (`tenant_id` null); CMP-005 profile GET with citizen token is `SF-TEN-001`. Tenant-scoped profile/DigiLocker stitch is officer-session-derived. Forged `x-tenant-id` still `SF-TEN-002`.
3. Consent is a CMP-030 port; INT used AllowConsent double; deny-closed `SF-AUTH-002` executed. REAL OTP / IdP / DigiLocker adapters not shipped; fail-closed verified (INT-013), not live provider behavior.
4. CMP-004 CITIZEN_PRIVATE / PLATFORM_OPERATIONAL tables documented `rls: NOT_APPLICABLE` (no `tenant_id`); isolation is citizen_id keyed; peer-component SELECT remains `42501`. Not counted as leakage.
5. INT/SEC verifier test assets remain on unmerged #64/#65; they are evidence references, not production SoT.
6. R-BRANCH-PROT remains an OPS accepted residual from M01 G4 (not leakage).
7. Standing: not CERTIFIED / not RELEASE CERTIFIED / not G6.

## Explicit non-claims

- Not CERTIFIED, not RELEASE CERTIFIED, not G6
- Recording agent does **not** self-certify (`self_certified: false`)
- Did not merge #64/#65/#66 or rewrite production
- Did not start M04
- Envelope YAML remains `state: READY` / `dispatched: false` for SF-M02-INT / SF-M02-SEC / SF-M02-EVD **task** envelopes
- `cg01_path_uniqueness_gate.py` not weakened

Machine-readable companion: `orchestrator/handovers/M02-GATE.yaml` (`recommended_gate: G3_INTEGRATION_VERIFIED`, `gate_issued: true`, `certified: false`). Evidence index: `evidence/SF-M02-EVD/`.
