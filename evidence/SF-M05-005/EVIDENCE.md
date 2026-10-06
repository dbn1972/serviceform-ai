# SF-M05-005 evidence — CMP-018 Inspection / Verification

Builder evidence only. **Not CERTIFIED. Not VERIFIED. Not G4/G6.** Do not merge.

## Identity

| Field | Value |
|---|---|
| Task | SF-M05-005 |
| Component | CMP-018 |
| Dispatch base | `ca57057a794739c03d0a46886577e25adf041815` (`origin/main` SHA-guard PASS) |
| Dispatch authorized | true |
| Branch | `cursor/m05-inspection-sf-m05-005-da43` |
| Schema | `sf_inspection` |
| Privilege role | `sf_cmp018_rw` NOLOGIN NOSUPERUSER NOBYPASSRLS |

## Local executed checks

| Check | Result | Log |
|---|---|---|
| unit + contract | 32/32 PASS | `logs/unit-contract.log` |
| PostgreSQL integration (PG 16, real LOGIN roles) | 11/11 PASS | `logs/pg-integration.log` |
| typecheck | PASS | `logs/typecheck.log` |
| eslint | PASS | `logs/eslint.log` |
| contracts-lock | 19/19 FROZEN MATCH | `logs/contracts-lock.log` |
| migration-lint | PASS | `logs/migration-lint.log` |
| hardcoding | PASS | `logs/hardcoding.log` |
| openapi/asyncapi | PASS | `logs/openapi-asyncapi.log` |

## Isolation / security (executed)

- FORCE RLS on every TENANT_SCOPED table; `tenant_id uuid NOT NULL`; PK includes tenant.
- Runtime login `sf_app` + `sf_cmp018_rw`: not superuser, not BYPASSRLS, owns 0 objects.
- Cross-tenant SELECT/UPDATE empty or 42501; CROSS_TENANT_LEAKAGE = 0.
- Peer component role denied DML.
- Isolated down → up leaves `sf_cmp018_rw` in place.

## Architecture notes

- Inspection `verification_result` is `VERIFIED \| NOT_VERIFIED \| INCONCLUSIVE \| DEFICIENCY_NOTED`. `statutory_effect` is constrained false. APPROVED/REJECTED/ELIGIBLE refused.
- CMP-015 tables never named in SQL. Case commands only via `CaseCommandPort` after domain commit (`ENTER_VERIFICATION` informational; `RECORD_APPROVED`/`RECORD_REJECTED` forbidden).
- INT-006: `EvidencePort` / `OcrPort`; DigiLocker SIMULATED port + production-critical fail-closed. CMP-012 not implemented.
- Scheduling metadata only (slot_ref / window / timezone); departmental calendar keys refused.
- Outbox Day 1 from frozen SF-CON-OUTBOX template (`{schema}=sf_inspection`, `{cmp}=CMP-018` only).
- `pnpm-lock.yaml` not written. Extra deps none. STITCH-B owns lockfile admission.

## Recommended gate (not issued)

ACCEPT for stitch input after independent INT/SEC/EVD. Builder cannot self-certify.
