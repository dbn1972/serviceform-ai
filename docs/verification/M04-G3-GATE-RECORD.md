# M04 G3 gate record (human issuance)

**Issued gate: `G3_INTEGRATION` + `_` + `VERIFIED` (M04 module-exit / integration verified)**

Human gate authority **Debabrata Nayak** issued this gate after INT / SEC / EVD review. This pull request **records** issuance only. The recording agent does **not** self-certify. **Not CERTIFIED. Not RELEASE CERTIFIED. Not G6.** Do **not** merge verifier evidence PRs [#80](https://github.com/dbn1972/serviceform-ai/pull/80), [#79](https://github.com/dbn1972/serviceform-ai/pull/79), or [#81](https://github.com/dbn1972/serviceform-ai/pull/81). Do **not** start or dispatch M05. Do **not** merge this gate-record PR without separate authorization.

| Field | Value |
|---|---|
| Module | M04 (Forms, rules, evidence, documents, AI Gateway; CMP-008/009/011/013/014/039; INT-011/013) |
| Human decision | **`G3_INTEGRATION` + `_` + `VERIFIED`** |
| Decision authority | Human gate authority / Debabrata Nayak |
| `gate_issued` / `gate_ready` / `gate_passed` / `human_gate_issued` | **true** |
| Lifecycle | `HUMAN_GATE_ISSUED` |
| Production base | `origin/main` `afc8e253` + `d4c566a4a18b1e01d9b0a1163f9d6adf` (merge [#78](https://github.com/dbn1972/serviceform-ai/pull/78)) |
| EVD recommendation head | `f3862c4c` + `1f97e4569f93a342ffa722ff72f60e34` ([#81](https://github.com/dbn1972/serviceform-ai/pull/81); recommends G3; do not merge) |
| Self-certified | **false** |
| CERTIFIED / G6 / RELEASE CERTIFIED | **false** (`not_certified: true`, `certified: false`, `release_certified: false`, `g6_claimed: false`) |
| Production code modified | **false** |
| Frozen contracts | **13/13 MATCH** |
| `CROSS_TENANT_LEAKAGE` | **0** |
| M05 | **OFF** (pending gate-record merge + green main; not started) |

Unmerged drafts [#80](https://github.com/dbn1972/serviceform-ai/pull/80), [#79](https://github.com/dbn1972/serviceform-ai/pull/79), and [#81](https://github.com/dbn1972/serviceform-ai/pull/81) remain **immutable evidence references**, not production source of truth. Do not cherry-pick verifier tests into `main`.

## Bound verifier / evidence results

| Gate | Source | Head SHA | Result | Merged | Certified |
|---|---|---|---|---|---|
| V1 Integration | [#80](https://github.com/dbn1972/serviceform-ai/pull/80) | `3736c023` + `18bb89c6f89cff31e2afc966ab15e27b` | `V1_INTEGRATION` + `_` + `PASS` | **false** (evidence ref) | **false** |
| V1 Security | [#79](https://github.com/dbn1972/serviceform-ai/pull/79) | `6c4b0a41` + `dfe77b694f4566dcdd903d5d49c7b337` | `V1_SECURITY` + `_` + `PASS` | **false** (evidence ref) | **false** |
| EVD recommendation | [#81](https://github.com/dbn1972/serviceform-ai/pull/81) | `f3862c4c` + `1f97e4569f93a342ffa722ff72f60e34` | recommended G3 (`gate_issued: false` on EVD) | **false** (superseded by this issuance record) | **false** |

M04 production components already on SoT via host merge [#78](https://github.com/dbn1972/serviceform-ai/pull/78) / STITCH-B [#77](https://github.com/dbn1972/serviceform-ai/pull/77) (not treated as unmerged sibling code for this record).

## Executed facts independently confirmed (bound)

| Fact | INT (#80) | SEC (#79) |
|---|---|---|
| Production base | `afc8e253` + `d4c566a4…` | `afc8e253` + `d4c566a4…` |
| Evidence PR head | `3736c023` + `18bb89c6…` | `6c4b0a41` + `dfe77b69…` |
| Local / catalog stamp | `local-m04-int` @ `2026-10-05T03:49:26Z` | catalog `assessed_at=2026-10-05T03:49:30.000Z` |
| Suites / probes | **11/11** PASS; **420** tests; INT-011 **PASS**; INT-013 **PASS** | vitest **17/17**; LOGIN catalog **296/0** |
| `CROSS_TENANT_LEAKAGE` | **0** | **0** |
| Frozen contracts | **13/13 MATCH** | **13/13 MATCH** |
| Production paths | **untouched** | **untouched** |
| Envelope uniqueness | `state: READY`, `dispatched: false` | `state: READY`, `dispatched: false` |
| `certified` | **false** | **false** |

EVD [#81](https://github.com/dbn1972/serviceform-ai/pull/81) @ `f3862c4c…` independently re-ran on production base `afc8e253…`: `contracts_lock_gate.py` **PASS** (13 FROZEN); `cg01_path_uniqueness_gate.py` **PASS**. Task envelopes SF-M04-INT / SF-M04-SEC / SF-M04-EVD remain `state: READY` / `dispatched: false` on those evidence branches. Gate scripts were not weakened.

### GitHub Actions (exact evidence heads; SUCCESS)

| PR | Head | `ci` | `security` | `developer-platform` |
|---|---|---|---|---|
| #80 | `3736c023…` | [37261885573](https://github.com/dbn1972/serviceform-ai/actions/runs/37261885573) SUCCESS | [37261885628](https://github.com/dbn1972/serviceform-ai/actions/runs/37261885628) SUCCESS | [37261885583](https://github.com/dbn1972/serviceform-ai/actions/runs/37261885583) SUCCESS |
| #79 | `6c4b0a41…` | [37262246722](https://github.com/dbn1972/serviceform-ai/actions/runs/37262246722) SUCCESS | [37262246579](https://github.com/dbn1972/serviceform-ai/actions/runs/37262246579) SUCCESS | [37262246572](https://github.com/dbn1972/serviceform-ai/actions/runs/37262246572) SUCCESS |
| #81 | `f3862c4c…` | [37263906664](https://github.com/dbn1972/serviceform-ai/actions/runs/37263906664) SUCCESS | [37263906652](https://github.com/dbn1972/serviceform-ai/actions/runs/37263906652) SUCCESS | [37263906665](https://github.com/dbn1972/serviceform-ai/actions/runs/37263906665) SUCCESS |

Corroborating SoT push on `afc8e253…`: ci [37258144686](https://github.com/dbn1972/serviceform-ai/actions/runs/37258144686), security [37258144700](https://github.com/dbn1972/serviceform-ai/actions/runs/37258144700), developer-platform [37258144667](https://github.com/dbn1972/serviceform-ai/actions/runs/37258144667) SUCCESS. GitHub SUCCESS is corroboration of repo gates on the bound heads; it is not a substitute for the local INT/SEC catalogs.

## SHA stamp map (authoritative bind)

| Role | SHA | Notes |
|---|---|---|
| Production base | `afc8e253` + `d4c566a4a18b1e01d9b0a1163f9d6adf` | Only production source of truth for this record |
| INT evidence PR head | `3736c023` + `18bb89c6f89cff31e2afc966ab15e27b` | Authoritative INT GitHub CI head; `V1_INTEGRATION` + `_` + `PASS` |
| SEC evidence PR head | `6c4b0a41` + `dfe77b694f4566dcdd903d5d49c7b337` | Authoritative SEC GitHub CI freeze; `V1_SECURITY` + `_` + `PASS` |
| EVD recommendation PR head | `f3862c4c` + `1f97e4569f93a342ffa722ff72f60e34` | Recommends G3; superseded by this issuance record |
| SEC evidence-doc stamp | `d2286fe2` + `bc6ed6b33853d7275a9bcd61dfe4579d` | Class E doc binding; ancestor of freeze; do not rewrite #79 |

## Residual disposition (authorized; non-blocking for issued G3; not leakage)

| Residual | Class | Disposition | Leakage? |
|---|---|---|---|
| INT REAL/SANDBOX provider / OCR / storage / scanner / DigiLocker adapters absent; fail-closed in PRODUCTION verified | **D** (`REAL_SANDBOX_ABSENT`) | `NON_BLOCKING_FOR_M04_G3` | **no** |
| SF-CON-OUTBOX publisher `USING true` / `sf_app` INSERT templates (ADR-0006 #9) | **ACCEPTED_FROZEN_RESIDUAL** | `NON_BLOCKING_FOR_M04_G3` | **no** (not `CROSS_TENANT_LEAKAGE`) |
| CMP-014 empty-repository stub may 500 after authz on some GET mounts | **A** | `NON_BLOCKING_FOR_M04_G3` | **no** |
| SEC `EVIDENCE.md` / summary stamps older head `d2286fe2…` while immutable freeze is `6c4b0a41…` | **CLASS_E_EVIDENCE_HEAD_BINDING** | `NON_BLOCKING_FOR_M04_G3` | **no** (authoritative SEC freeze `6c4b0a41…`; do **not** rewrite #79) |

No unresolved **blocking** residual for issued G3.

## Explicit non-claims

- Not CERTIFIED, not RELEASE CERTIFIED, not G6
- Recording agent does **not** self-certify (`self_certified: false`)
- Did not merge #79 / #80 / #81 or rewrite production
- Did not cherry-pick verifier tests into `main`
- Did not start or dispatch M05
- Did not treat unmerged PRs as production SoT
- This gate-record PR must **not** be merged without separate authorization
- Envelope YAML uniqueness keys for SF-M04-INT / SF-M04-SEC / SF-M04-EVD **task** envelopes remain `state: READY` / `dispatched: false` on their evidence branches
- `cg01_path_uniqueness_gate.py` not weakened

Machine-readable companion: `orchestrator/handovers/SF-M04-GATE.yaml` (`gate` family `G3_INTEGRATION` / status `VERIFIED`, `gate_issued: true`, `human_gate_issued: true`, `certified: false`).
