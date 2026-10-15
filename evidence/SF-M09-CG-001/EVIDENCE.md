# SF-M09-CG-001 evidence — M09 freeze preparation (candidate)

**Not merged. Repository freeze not effective. Not CERTIFIED. Not G4. Not G6. Wave A OFF. Builders OFF.**

Sole writer of `orchestrator/contracts-lock.yaml` for this slice (`APPEND_NEW_M09_ROWS_ONLY`).
Authorized by `HUMAN_CG03_THROUGH_EVD_AUTHORIZATION = true` (LOCK-2), decision authority Debabrata Nayak.

| Field | Value |
|---|---|
| Task | SF-M09-CG-001 |
| Branch | `cursor/m09-cg-001-freeze-91f2` |
| Branch base | `origin/main` `667c59171a0181e405cde289dd068bb267c965da` |
| Lock baseline | `origin/main` `667c5917…`, lock v2.6, 34 rows |
| Lock candidate | v2.7, 42 rows (34 existing + 8 NEW appended) |
| `freeze_authorized` | true |
| `freeze_prepared` | true |
| `repository_freeze_effective` | **false** |
| `implementation_authorized` / `dispatched` / `wave_a_eligible` | false / false / false |
| `contracts_status` / `freeze_status` | FROZEN_CANDIDATE / PENDING_MERGE |
| `ccr_required` | **false** |
| `certified` / `g4` / `g6` / `self_certified` | false / false / false / false |

## Executed checks (this tree)

| Check | Result | Log |
|---|---|---|
| `node evidence/SF-M09-CG-001/validate-m09-schemas.mjs` | PASS, 8 contracts, 0 failures (Ajv 2020 strict; 8 valid + 11 invalid examples; invariant asserts) | `logs/schema-validate.log` |
| `python3 evidence/SF-M09-CG-001/contracts-lock-safety.py` | PASS: existing 34 rows identical to `origin/main` (all keys, order preserved), file hashes match, 8 NEW rows appended, 42/42 FROZEN; shared/m05/m06/m07/m08/db-migrations unchanged | `logs/contracts-lock-safety.{log,json}` |
| `python3 scripts/gates/contracts_lock_gate.py` | PASS, 42 FROZEN | `logs/gates-run.log` |
| `python3 scripts/gates/run_all.py` | 10/10 gates passed | `logs/gates-run.log` |
| `python3 -m pytest -q scripts/gates/tests` | 30 passed | `logs/gate-tests.log` |
| `python3 evidence/SF-M09-CG-001/static-scan.py` | PASS (no PII field names, named officials or invented period fields; examples synthetic) | `logs/static-scan.log` |

## M09 contract SHA-256

| ID | Owner | SHA-256 |
|---|---|---|
| SF-CON-APPOINTMENT | CMP-056 | `9f6d8ba5f5ae6ac576bf2847ab6abf8a2e456e766343baa8ef380a27ebd57fd6` |
| SF-CON-ASSISTED-SESSION | CMP-057 | `33656e9ded20833251cdd66499b30ee2bbef572ad9ebeced2ae03ad95725ff72` |
| SF-CON-SEMANTIC-ELEMENT | CMP-058 | `460fadf73dbe08ee14769c3d74034ef76fb26a9227e5314cc91041e2f006fe0c` |
| SF-CON-MIGRATION-PROJECT | CMP-059 | `62e8b1645a2ce904e339034b902792eaa5bc886b0f67f4d20dd96a90c58d078b` |
| SF-CON-RISK-ASSESSMENT | CMP-060 | `cd5084bbe413bae266cdea81e60de5edb54fba089ed2f0f814e4353780d61fdc` |
| SF-CON-PRIVACY-REQUEST | CMP-061 | `56ef4ab905024676fa1401f69c6020b5df6e41cae6098453ad4abcd0e6af2fc3` |
| SF-CON-SFPACKAGE-MANIFEST | CROSS | `365d794255986bc4c036f5bba3f481c11679ee68b136ef9e80141105fcacd9c9` |
| SF-CON-BPMN-PROFILE | CROSS | `7f818f0b798c89c16263135a6ad3efbc1f836674d6384c5244170de09a24c28d` |

## Invariants encoded and negative examples

| Invariant | Negative example |
|---|---|
| Notification failure does not invalidate booking | `appointment.notification-invalidates-booking.json` |
| Capacity is atomic | `appointment.capacity-not-atomic.json` |
| `applied_by` distinct from `applied_for` | `assisted-session.applied-by-not-distinct.json` |
| Risk assessment non-authoritative | `risk-assessment.authoritative-decision.json` |
| Dry-run required before execute | `migration-project.dry-run-optional.json` |
| No cross-component direct mutation | `privacy-request.cross-component-mutation.json` |
| Orchestration only | `privacy-request.not-orchestration-only.json` |
| No embedded secrets in `.sfpackage` | `sfpackage-manifest.embedded-secrets-allowed.json` |
| Temporal remains runtime | `bpmn-profile-report.temporal-replaced.json` |
| Canonical ServiceForm Workflow Model | `bpmn-profile-report.wrong-canonical-model.json` |
| No invented statute | `semantic-element.invented-statute-allowed.json` |

## Explicit non-claims

Did not start Wave A or dispatch builders. Did not claim CERTIFIED, G4 or G6.
Repository freeze remains pending merge. Did not invent statutory calendars, representation,
eligibility, fee, SLA, or privacy policy. Gate status is a recommendation for human/CI approval only.
