# SF-M05-004 evidence (builder): CMP-029 SLA & Escalation Engine

**Not CERTIFIED. Not G4. Not G6.** Builder output only; no self-certification. Independent
verification (opus route), STITCH-A, SF-M05-SEC/INT/EVD remain separate and are not started.

| Item | Result |
|---|---|
| Authorized base | `6e9f0481eb3007dedee5580838cab59ceea66f03` (origin/main matched at dispatch) |
| Implementation commit | `99765b4dbbf0da105b9ee900ad01e01e88d24d10` (`logs/meta.txt`) |
| Branch | `agent/M05-sla-SF-M05-004` |
| Model / effort | claude-sonnet-5-5 / high |
| Unit + contract (service) | 90 passed (`logs/unit.log`, `junit/unit.xml`) |
| Integration (PostgreSQL 16, real login roles) | 16 passed (`logs/integration.log`, `junit/integration.xml`) |
| DB harness (`pnpm db:test`, full up/down/up) | 17 passed (`logs/db-test.log`) |
| Root unit + coverage | pass; branches 72.86% (threshold 70) (`logs/root-unit-coverage.log`) |
| Typecheck / ESLint / Prettier | pass (`logs/typecheck.log`, `logs/eslint.log`, `logs/format.log`) |
| Architecture gates (10) + gate self-tests (25) | pass (`logs/gates.log`, `logs/gate-selftests.log`) |
| Migration lint | PASS (`logs/migration-lint.log`) |
| Dependency graph (no cross-component import) | pass (`logs/depcruise.log`) |
| Semgrep (CI config incl. `.semgrep/`) | 0 findings (`logs/semgrep.log`) |
| Frozen contracts | 19/19 hashes match; `contracts/**` and `orchestrator/contracts-lock.yaml` unchanged |
| CCR required | false |
| Lockfile | `pnpm-lock.yaml` untouched; package declares no dependencies |
| `CROSS_TENANT_LEAKAGE` | 0 (unit tenant-keyed repo; PostgreSQL FORCE RLS; API on PostgreSQL) |

## Required negative tests (all executed)

| Requirement | Where |
|---|---|
| Wrong tenant denied | `sla-api.test.ts` (wrong tenant), `api-flow.int.test.ts`, `privilege-rls.int.test.ts` |
| Pause without allowed/published reason rejected | `sla-api.test.ts` (pause rules), `clock-domain.test.ts`, frozen invalid example |
| Resume of a non-paused clock rejected | `sla-api.test.ts`, `clock-domain.test.ts`, frozen invalid example |
| Clock cannot directly mutate case state | `sla-api.test.ts` (dependencies/events), `contracts.test.ts` (no case reference/grant), `privilege-rls.int.test.ts` (no DML outside `sf_sla`) |
| Client-provided time never authoritative | `sla-api.test.ts` (every time key, query, all commands), DB trigger test (deadline edit refused) |
| SMS/e-mail/provider implementation absent | `contracts.test.ts` (no provider files/imports/network/dependencies; port carries no channel/recipient) |

## Database posture (ADR-0006)

`sf_cmp029_rw` NOLOGIN NOSUPERUSER NOBYPASSRLS; tables owned by `sf_migrator`; runtime login not a
member of the owner; `SET ROLE` into another component role refused; FORCE RLS on all nine tables;
`sf_app` holds no UPDATE/DELETE and no INSERT on authoritative tables; `sf_cmp029_rw` has no DML on
any other schema; another component's login is denied on every `sf_sla` table; triggers keep
policies/calendars immutable, history insert-only, and the deadline changeable only by resume.

## Residual notes for the verifier

- Contract tests resolve AJV through `packages/contracts`; integration tests resolve the driver
  through `db` (test-time resolution because the package declares no dependencies).
- Host mount, Fastify adapter and the real `SqlPool` are SF-M05-009 concerns.
- CI run identifiers are recorded in the freeze report after the exact-head run completes.
