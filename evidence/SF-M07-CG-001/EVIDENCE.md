# SF-M07-CG-001 evidence — M07 freeze preparation (candidate)

**Not merged. Repository freeze not effective. Not CERTIFIED. Not G3. Not G6. Wave A OFF. Builders OFF.**

Sole writer of `orchestrator/contracts-lock.yaml` for this slice (`APPEND_NEW_M07_ROWS_ONLY`).
Authorized by `HUMAN_M07_THROUGH_EVD_AUTHORIZATION = true` (LOCK-2), decision authority Debabrata Nayak.

| Field | Value |
|---|---|
| Task | SF-M07-CG-001 |
| Branch | `cursor/m07-cg-001-freeze-91f2` |
| Branch base | `origin/cursor/m07-planning-91f2` `29006997f34335c4f493be0c59adaf4343018de0` |
| Lock baseline | `origin/main` `fd335e8cfd6a3c616f5133d09191e721201d4ab5`, lock v2.5, 29 rows |
| Lock candidate | v2.6, 34 rows (29 existing + 5 NEW appended) |
| `freeze_authorized` | true |
| `freeze_prepared` | true |
| `repository_freeze_effective` | **false** |
| `implementation_authorized` / `dispatched` / `wave_a_eligible` | false / false / false |
| `contracts_status` / `freeze_status` | FROZEN_CANDIDATE / PENDING_MERGE |
| `ccr_required` | **false** |
| `certified` / `g3` / `g6` / `self_certified` | false / false / false / false |

## Executed checks (this tree)

| Check | Result | Log |
|---|---|---|
| `node evidence/SF-M07-CG-001/validate-m07-schemas.mjs` | PASS, 5 contracts, 0 failures (Ajv 2020 strict; 5 valid + 10 invalid examples; invariant asserts) | `logs/schema-validate.log` |
| `python3 evidence/SF-M07-CG-001/contracts-lock-safety.py` | PASS: existing 29 rows identical to `origin/main` (all keys, order preserved), file hashes match, 5 NEW rows appended, 34/34 FROZEN; shared/m05/m06/m08/db-migrations unchanged | `logs/contracts-lock-safety.{log,json}` |
| `python3 scripts/gates/contracts_lock_gate.py` | PASS, 34 FROZEN | `logs/gates-run.log` |
| `python3 scripts/gates/run_all.py` | 10/10 gates passed | `logs/gates-run.log` |
| `python3 -m pytest -q scripts/gates/tests` | 30 passed | `logs/gate-tests.log` |
| `python3 evidence/SF-M07-CG-001/static-scan.py` | PASS (no PII field names, named officials or invented period fields; examples synthetic) | `logs/static-scan.log` |

The raw lock diff against `origin/main` is 60 lines added and 1 replaced (`version: "2.5"` to `"2.6"`).
No existing contract row line changed.

## M07 contract SHA-256

| ID | Owner | SHA-256 |
|---|---|---|
| SF-CON-CREDENTIAL | CMP-022 | `67ab673451ccb66a47393a78643cef7e0b9ab3503df83205dd2ea25e09fe4499` |
| SF-CON-SIGNING-RECORD | CMP-022 | `61e1e8e7df782f9448381ade8c1df44d3259cf8aee637557cd05e49331000cd9` |
| SF-CON-CREDENTIAL-STATUS | CMP-024 | `509557f410b70f1cb3cbd0cc823da213d1eede7fcdbbd0e1b590b40983c69f9f` |
| SF-CON-VERIFICATION-TOKEN | CMP-023 | `c17dc5b2b703f4dbe5648fdbedba97ef2660987d8fe5ccf3e6a49f533a22d8e0` |
| SF-CON-DIGILOCKER-PUBLISH | CMP-012 | `ca0b302aeab1c85f3f387015a74240070a9b5c715d7713adb1f7cdd4bf5e87c7` |

## Invariants encoded and negative examples

| Invariant | Negative example |
|---|---|
| CMP-022 does not decide approval | `credential.approval-decided.json` |
| SIGNED/ISSUED needs signing record + signed artifact | `credential.issued-unsigned.json` |
| SIMULATED requires simulation marker | `signing-record.simulated-without-marker.json`, `digilocker-publish.simulated-without-marker.json` |
| Marker forbidden outside SIMULATED | `signing-record.real-with-marker.json` |
| Suspend/revoke requires metadata reason ref | `credential-status.revoked-without-reason.json` |
| Registry (CMP-024) owns status | `credential-status.non-registry-authority.json`, `verification-token.status-writable.json` |
| No PII in public QR view | `verification-token.embedded-pii.json` |
| Publish failure never reverses issuance or changes registry status | `digilocker-publish.reverses-issuance.json` |

## Known consequence for reviewers

`evidence/SF-M06-CG-001` and `evidence/SF-M08-CG-001` `contracts-lock-safety.py` assert exactly 29 lock
entries and will report FAIL on a 34-row lock. They are historical CG-02 evidence, are not invoked by
`scripts/gates/run_all.py`, and are read-only for this task. The authoritative check remains
`contracts_lock_gate.py` (PASS).

## Explicit non-claims

Did not open or merge a PR. Did not start Wave A or dispatch builders. Did not claim CERTIFIED, G3 or G6.
Repository freeze remains pending merge. Did not invent DigiLocker or eSign statutory policy.
Gate status is a recommendation for human/CI approval only.
