# SF-M09-003 evidence — CMP-058 Semantic Registry

Builder candidate evidence only. **Not CERTIFIED / not G3 / not G4 / not G6 / not self-certified.**
Recommended gate status: none (builder candidate). Independent INT / SEC / EVD and human/CI gates remain.

- Authorization: `HUMAN_CG03_THROUGH_EVD_AUTHORIZATION` (CG-03 through EVD).
- Execution base: `fd7492b398b2945713957a53b42c4717a7940c3f` (`origin/main` Wave A READY #159).
- Branch: `cursor/m09-003-semantic-91f2`.
- DRAFT PR: https://github.com/dbn1972/serviceform-ai/pull/160
- Privilege role / schema: `sf_cmp058_rw` / `sf_semantics`.
- Contracts consumed (FROZEN): SF-CON-SEMANTIC-ELEMENT + shared outbox/authz/idempotency/audit.

## Opaque refs / no invented field meanings
- Element records store `element_id`, `element_code`, lifecycle, privacy classification, optional
  `code_list_binding_ref` only. No statutory meaning / eligibility / government field definitions.
- HTTP schemas use `additionalProperties: false`. `invented_statutory_policy_forbidden: true` on
  mapping validation success payload. Invalid frozen example requires the const `true`.
- Bindings pin opaque `(element_id, element_version)` for PUBLISHED elements only (INT-016).

## Executed checks (logs in `logs/`)
| Check | Result | Log |
|---|---|---|
| tsc `--noEmit` (package) | exit 0 | `typecheck.log` |
| ESLint `--max-warnings=0` (package) | exit 0 | `eslint.log` |
| Prettier `--check` (package + handover) | exit 0 | `prettier.log` |
| Unit + contract (vitest) | 35/35 pass | `unit-contract.log`, `junit/unit.xml` |
| Integration on PostgreSQL 16.15 (fresh DB, full migration chain, real LOGIN roles, FORCE RLS) | 7/7 pass | `integration-postgres16.log`, `junit/integration.xml` |
| Repo gates `scripts/gates/run_all.py` | 10/10 PASS | `gates.log` |

Commands (from `services/cmp-058-semantic-registry`):
`tsc --noEmit -p tsconfig.json`; `vitest run --root . --config vitest.unit.config.ts`;
`DATABASE_URL=… vitest run --root . --config vitest.integration.config.ts`.

## Requirement → test traceability
- Opaque refs / no invented meanings: `contracts.test.ts`, `plugin-http.test.ts` invented-policy cases,
  `api.int.test.ts` happy path body assertions.
- Published immutability: DB trigger in privilege integration; publish/deprecate unit cases.
- INT-016 bind/validate/usage: unit + `api.int.test.ts`.
- INT-011 FORCE RLS / privilege role: `privilege-boundary.int.test.ts`.
- Outbox template substitution: `contracts.test.ts`.

## Scope / residuals
- `pnpm-lock.yaml` not modified (`EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL`); package.json uses
  empty deps pattern until STITCH-A/HOST admits the workspace importer.
- Host mount deferred to SF-M09-HOST.
- OPA policy data for `SEMANTIC_*` actions lives in `policy/**` (read-only for this lane).
- `g4=false`, `g6=false`, `certified=false`, `self_certified=false`.
