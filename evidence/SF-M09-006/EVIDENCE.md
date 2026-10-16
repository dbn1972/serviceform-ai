# SF-M09-006 builder evidence (CMP-061 Privacy Rights Centre)

Builder output only. Not CERTIFIED, not G4, not G6, not self-certified.
Recommended gate status: `CANDIDATE_COMPLETE` / `BUILDER_CANDIDATE_READY` for independent review.

| Field | Value |
|---|---|
| Task / component | SF-M09-006 / CMP-061 (INT-019, INT-011) |
| Branch | `cursor/m09-006-privacy-91f2` |
| Schema / role | `sf_privacy` / `sf_cmp061_rw` |
| Frozen contract | SF-CON-PRIVACY-REQUEST (`cross_component_direct_mutation_forbidden=true`, `owner_task_orchestration_only=true`) |
| CERTIFIED / G4 / G6 / self_certified | false / false / false / false |

## What was built

- Migrations: `1761300000000_cmp-061-privacy-centre.sql`, `1761300000001_cmp-061-outbox.sql`
- Service `@serviceform/cmp-061-privacy-centre`: submit / me / consents / get / request owner tasks / task outcomes / complete / withdraw / deny
- Orchestration only: owner fulfilment via outbox events; no foreign-schema SQL
- Opaque `legal_basis_or_exception_ref` only (`POLICY_INPUT_REQUIRED`); no invented privacy statute

## Executed local checks

| Check | Result | Log |
|---|---|---|
| `tsc --noEmit` | pass | `logs/typecheck.log` |
| unit + contract + security | 27 passed | `logs/unit.log`, `junit/unit.xml` |

## Residuals

- `EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL` (no `pnpm-lock.yaml` change; host mount deferred to SF-M09-HOST)
- Consent history is owner-port / CMP-030; `/v1/privacy/me/consents` returns empty + `OWNER_PORT_REQUIRED`
- Integration/RLS harness requires `DATABASE_URL` (local unit suite does not need Postgres)
- Gitleaks CI may still fail on unrelated `fixtures/golden/ind-soc-002` history from SF-M10-002 (out of this lane's write paths)

## Non-claims

CERTIFIED=false · G4=false · G6=false · self_certified=false · no invented DPDP/statutory privacy text.
