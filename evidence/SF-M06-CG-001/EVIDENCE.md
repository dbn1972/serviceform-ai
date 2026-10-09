# SF-M06-CG-001 evidence — freeze preparation (candidate)

**Not merged. Repository freeze not effective. Not CERTIFIED. Not G6. Wave A OFF. Builders OFF.**

Combined CG-02 freeze with SF-M08-CG-001. Sole writer of `orchestrator/contracts-lock.yaml` (APPEND_NEW_CG02_ROWS_ONLY).

| Field | Value |
|---|---|
| Task | SF-M06-CG-001 |
| Slice | freeze preparation (ten NEW lock rows total across M06+M08) |
| Base | `main` `2add535cff20ee6ecdcbeacfdc2074029c89be2b` |
| `freeze_authorized` | true |
| `freeze_prepared` | true |
| `repository_freeze_effective` | **false** |
| `implementation_authorized` | false |
| `dispatched` | false |
| `wave_a_eligible` | false |
| `contracts_status` | FROZEN_CANDIDATE |
| `freeze_status` | PENDING_MERGE |
| `state` | FREEZE_PREPARED |
| `ccr_required` | **false** |
| Existing frozen 19 | **MATCH**, hashes changed = 0, shared/m05 files changed = 0 |
| Lock | **29/29 FROZEN_CANDIDATE** |
| Lock mode | `APPEND_NEW_CG02_ROWS_ONLY` |

## Local executed checks (this tree)

| Check | Result |
|---|---|
| `python3 scripts/gates/contracts_lock_gate.py` | PASS, 29 FROZEN |
| `python3 scripts/gates/run_all.py` | 10/10 gates passed |
| `node evidence/SF-M06-CG-001/validate-m06-schemas.mjs` | PASS |
| `python3 evidence/SF-M06-CG-001/contracts-lock-safety.py` | 29/29; existing_19 hashes_changed=0 |
| `python3 evidence/SF-M06-CG-001/static-scan.py` | PASS |

## M06 contract SHA-256

| SF-CON-FEE-QUOTE | `cf5c47aeb958b3eafca7f2cbb1f6f84ddf61fc9bac5978763cbf862e29968015` |
| SF-CON-PAYMENT-INTENT | `776d1f6eae458efe4620d6175bf04d185f6cdfe9f9a9ed84ba68c2513b04b0ef` |
| SF-CON-PAYMENT-CALLBACK | `ca0bacba68d9dd2ee4baa543d2314215ad7ad4603f374991704a1a855fbaff3a` |
| SF-CON-NOTIFICATION-DISPATCH | `9f3e790a54d4b6a7b0ad7481f3b12ee8cab14a9d56d55928c7b657e94f7f38e9` |
| SF-CON-MESSAGE-THREAD | `dd634d71d1593e586da3ea17a03f1dc0f5f116dd45c194a04ca3c5be0e67ce4b` |

## CCR

**CCR_REQUIRED = false.** Existing 19 hashes unchanged. `contracts/shared/**` and `contracts/m05/**` file changes = 0.

## Explicit non-claims

Did not merge. Did not start Wave A. Did not dispatch builders. Did not claim CERTIFIED / G6. Repository freeze remains pending merge. Did not invent CMP-049 statutory retention periods. Did not touch #107/#108/#109.
