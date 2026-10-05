# SF-M05-CG-001 evidence — human ADR acceptance, contracts still PROPOSED

**Not a contracts freeze. Not CERTIFIED. Not G6. Wave A OFF.**

| Field | Value |
|---|---|
| Task | SF-M05-CG-001 |
| Slice | human ADR acceptance + policy-gated WITHDRAWN/CANCELLED |
| Base | `main` `8564055e3d82cf52ddba29086af3cfffddc48f89` |
| Prior head | `c50379e0734643e8e882a1114aacab2f8867ec97` (do not merge) |
| `pre_freeze_authorized` | true |
| `freeze_authorized` | false |
| `implementation_authorized` | false |
| `dispatched` | false |
| `wave_a_eligible` | false |
| `contracts_status` | PROPOSED |
| `state` | READY_FOR_FREEZE_REVIEW |
| `ccr_required` | **no** |
| Existing frozen 13 | **13/13 MATCH**, hashes changed = 0, `contracts/shared` files changed = 0 |
| ADR-0003 / ADR-0005 | **ACCEPTED** by Debabrata Nayak, 5 October 2026 |

## Local executed checks (this tree)

| Check | Result |
|---|---|
| `python3 scripts/gates/contracts_lock_gate.py` | PASS, 13 FROZEN |
| `python3 scripts/gates/run_all.py` | 10/10 gates passed |
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS |
| `pnpm contracts:validate` (shared 13 only) | PASS |
| `node evidence/SF-M05-CG-001/validate-m05-schemas.mjs` | 6 compile; unique `$id`; no circular M05 `$ref`; negative WITHDRAWN/CANCELLED ALWAYS_LEGAL and uncommitted request examples FAIL as required |
| `python3 evidence/SF-M05-CG-001/contracts-lock-safety.py` | frozen=13, hashes_changed=0, no M05 ids in lock |
| `python3 evidence/SF-M05-CG-001/static-scan.py` | PASS; `alwaysLegalTransitionKey` contains no `>WITHDRAWN` / `>CANCELLED` |

## Classification (ADR-0003)

All CMP-015 transitions whose `to_state` is `WITHDRAWN` or `CANCELLED` are `POLICY_GATED_WITHDRAWAL` or `POLICY_GATED_CANCELLATION`. None remain in `alwaysLegalTransitionKey`. Policy-gated commits require `request_construct.kind` matching the class and `status=COMMITTED`. Service availability stays published policy/rules.

## CCR

**CCR_REQUIRED = no.** SF-CON-AUTHZ-DECISION unchanged.

## Explicit non-claims

Did not freeze M05 contracts. Did not append the lockfile. Did not start Wave A. Did not merge prior head `c50379e`.
