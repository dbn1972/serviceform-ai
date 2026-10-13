# SF-M08-006 evidence — CMP-006 Service Discovery Engine

Builder candidate evidence only. **Not CERTIFIED / not G3 / not G6 / not self-certified.** No gate is
issued here; independent INT / SEC / EVD review and a human or CI gate are still required.
Recommended gate status: none (builder candidate).

- Authorization: `HUMAN_M08_WAVE_B_THROUGH_EVD_AUTHORIZATION`.
- Execution base (exact): `6ef081cce49aad78f2af9138de443334588fa45f` (`origin/main` after SF-M08-STITCH-A #133).
- Branch: `cursor/m08-006-discovery-91f2`. No PR opened by the builder; not merged.
- Implementation commit the logs were produced on: `93b0ae0e244d794ab1801b8cd649b7075d786e26`
  (`logs/impl-head.txt`). Later commits add only this evidence directory and the handover.
- Agent / model: Cursor Cloud Agent, `serviceform-foundation-builder`, route `opus`, release
  `claude-opus-5-5` (planning envelope listed `sonnet`; recorded in the handover). Self-assessment
  is not evidence.

## What was built
`@serviceform/cmp-006-service-discovery` (`services/cmp-006-service-discovery`), schema
`sf_discovery`, privilege role `sf_cmp006_rw`, migrations `1760370000000_cmp-006-service-discovery.sql`
and `1760370000001_cmp-006-outbox.sql` (SF-CON-OUTBOX template, documented substitutions only).
Routes: `POST /v1/discovery/queries`, `GET /v1/discovery/queries/{id}`,
`POST /v1/discovery/queries/{id}/selections`. Events on `sf.discovery.events.v1`:
`DiscoveryQueryExecuted`, `DiscoveryServiceSelected`; audit on `sf.audit.ingest.v1`.

## Executed checks (logs in `logs/`)
| Check | Result | Log |
|---|---|---|
| tsc `--noEmit` (package) | exit 0 | `typecheck.log` |
| ESLint `--max-warnings=0` (package) | exit 0 | `eslint.log` |
| Prettier `--check` (package + handover) | exit 0 | `prettier.log` |
| Unit + contract (vitest) | 51/51 pass (14 domain/input, 23 service/API, 14 contract/static) | `unit-contract.log`, `junit/unit.xml` |
| Integration on PostgreSQL 16.15 (full migration chain, real LOGIN roles, FORCE RLS) | 14/14 pass (9 privilege/RLS/DB-guard/reversibility, 5 API flow) | `integration-postgres16.log`, `junit/integration.xml` |
| Repo gates `scripts/gates/run_all.py` | 10/10 PASS (migration-lint, hardcoding, contracts-lock, openapi-asyncapi, cg01 uniqueness, …) | `gates.log` |
| Write scope `check_scope.py --envelope orchestrator/handovers/SF-M08-006.yaml --base origin/main` | PASS, 57 files, 0 errors | `scope.log`, `write-scope-diff.txt` |

Commands (from `services/cmp-006-service-discovery`): `tsc --noEmit -p tsconfig.json`;
`vitest run --root . --config vitest.unit.config.ts`;
`DATABASE_URL=… vitest run --root . --config vitest.integration.config.ts` (throwaway local
database; credentials not recorded). CI-only checks (CodeQL, Semgrep, gitleaks, checkov, coverage
thresholds, dependency-cruiser) were not run on the builder VM.

## Requirement → test traceability
- **SF-CON-DISCOVERY-QUERY conformance**: `contracts.test.ts` validates every returned query envelope (POST and stored GET) against the frozen schema with Ajv; frozen valid/invalid examples; component limits equal frozen bounds; constant markers cannot be flipped (`domain.test.ts` "statutory marker cannot be flipped").
- **Jurisdiction-aware availability via master data ports**: `domain.test.ts` "jurisdiction-aware availability"; `service.test.ts` "returns services available in the requested jurisdiction or an enclosing one", unknown/inactive codes refused.
- **Catalogue pins via ports**: unpublished/unknown pins fail closed (`domain.test.ts` "catalogue pin", `service.test.ts` "unpublished or unknown catalogue pins…"); results carry the query pin (`privilege-rls.int.test.ts` "results must carry the query catalogue pin"); selection re-checks the pin.
- **No cross-tenant leakage**: leaked foreign search hit / catalogue entry / pin abort with `CROSS_TENANT_RESULT_BLOCKED` before persistence (`service.test.ts`, `api-flow.int.test.ts`); FORCE RLS, no-tenant session, cross-tenant FK (`privilege-rls.int.test.ts`); tenant headers/body refused; tenant B cannot read or select on tenant A queries.
- **INT-003 non-mutating until citizen acts**: `service.test.ts` "running queries never records a selection or a draft intent"; selection owner-only, recorded-result-only, exact pins, once, idempotent (`service.test.ts`, `privilege-rls.int.test.ts` "INT-003 …", `api-flow.int.test.ts`); `draft_created=false` constant (DB CHECK).
- **No network in DB transactions / fail closed**: `service.test.ts` "no port is ever called while a database transaction is open", port outage/malformed → 503 audited; atomic commit.
- **OPA / audit**: denial audited `DENIED`, PDP outage 503, INTEGRATION actor refused; PEP inputs validate against SF-CON-AUTHZ-DECISION; audit/outbox envelopes validate against shared schemas.
- **Ports only, no peer SQL, no named service/jurisdiction**: `contracts.test.ts` "architecture guards (static)"; `no-hardcoded-jurisdictions` gate.
- **Privilege posture** (`sf_cmp006_rw` NOLOGIN NOSUPERUSER NOBYPASSRLS; sf_migrator owner; no UPDATE/DELETE grants on discovery tables; insert-only triggers) and reversible migration pair: `privilege-rls.int.test.ts`.

## Data minimisation and statutory boundaries
- Raw keyword text is returned to the caller only; never stored, emitted or audited (`keyword_count` only). Asserted in unit and PostgreSQL tests.
- Results are non-statutory projections (`result_is_non_statutory=true` in service, frozen schema and DB CHECK). No eligibility vocabulary in source (static test).
- **No retention period invented**: no INTERVAL, day/month/year count or retention column in CMP-006 code or migrations (static test). Retention of `sf_discovery` rows is owner input via CMP-049.
- Fixtures use synthetic UUIDs and synthetic codes (`JUR-P`, `SVC_SYNTHETIC_01`); no PII or secrets.

## Scope
`logs/write-scope-diff.txt` lists every path changed against the execution base. 0 lines changed in
`pnpm-lock.yaml`, `apps/**`, `contracts/**`, `orchestrator/contracts-lock.yaml`,
`services/cmp-035-search-indexing/**`. Frozen contracts unaltered; `ccr_required=false`.

## Residuals (explicit)
1. `EXPECTED_STITCH_LOCKFILE_ADMISSION_RESIDUAL` — the new workspace package needs an importer row in `pnpm-lock.yaml` (not modified here; the package declares no dependencies).
2. OPA policy data for `DISCOVERY_QUERY`, `DISCOVERY_QUERY_READ`, `DISCOVERY_SERVICE_SELECT` lives in `policy/**` (read-only for this lane); until added the PDP denies (fail-closed).
3. Real CMP-001 / CMP-003 / CMP-035 / CMP-053 port adapters are wired by the host (SF-M08-007); tests use in-process fakes.
4. The INT-003 draft-owner consumer of `DiscoveryServiceSelected` (CMP-009 / CMP-015) is not built here.
5. Assisted / representative selection (INT-015) is not supported; selection is citizen-owner only.
6. Host mount deferred to SF-M08-007; no UI. Local DB was PostgreSQL 16.15 (distro); CI uses `postgres:16.14-alpine`.
