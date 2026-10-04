# SF-M04-001 CMP-039 AI Gateway: builder evidence (not CERTIFIED)

| Field | Value |
|---|---|
| Task | SF-M04-001 (Wave A, LOCK-2) |
| Component | CMP-039 AI Gateway |
| Integrations | INT-011 (tenant isolation chain), INT-013 (SIMULATED provider, production fail-closed) |
| Base | origin/main `9ccc2b02f8ef` (post-#68) |
| Code commit | `f88d13d9f9f9` (PR head and final SHA are reported on the PR) |
| Environment | Linux, Node 22.14, pnpm 10.28.0, PostgreSQL 16.15, connector mode SIMULATED (`SF_ENVIRONMENT=CI/LOCAL`) |
| Recommended gate | DEVELOP complete. VERIFY/CERTIFY pending independent roles. |
| CERTIFIED / G6 | **false**. M05 OFF. |

## Commands and results (logs in `logs/`, JUnit in `junit/`)

| Check | Command | Result |
|---|---|---|
| Component unit + contract | `pnpm --filter @serviceform/cmp-039-ai-gateway run test:unit` | 51 passed (`logs/unit.log`, `junit/unit.xml`) |
| Component coverage | vitest v8 over `src/**` | 96.0% lines, 83.9% branches (`logs/unit-coverage.log`) |
| Tenant / RLS / privilege (PostgreSQL) | `pnpm --filter @serviceform/cmp-039-ai-gateway run test:integration` | 10 passed (`logs/integration.log`, `junit/integration.xml`) |
| Typecheck | `pnpm typecheck` | pass |
| Format / lint | `pnpm format:check`, `pnpm lint` (max-warnings 0) | pass |
| Root unit + coverage thresholds | `pnpm test:coverage` | 576 passed; lines 87.6%, branches 72.2% (thresholds 80/70) |
| Migrations up/down | `pnpm db:test` | 17 passed |
| Migration lint | `scripts/gates/migration_lint.py` | pass (`logs/migration-lint.log`) |
| Architecture gates | `scripts/gates/run_all.py` | 10/10 pass, contracts-lock 13 FROZEN (`logs/architecture-gates.log`) |
| Contracts validate | `pnpm contracts:validate` | 12 shared contract examples, 0 failures |
| Dependency graph | `pnpm deps:graph` | no violations |
| Build | `pnpm build` | pass |
| Semgrep (CI rule packs + `.semgrep/`) | `semgrep scan --error ...` | 0 findings (`logs/semgrep.log`) |
| Gitleaks | `gitleaks git --config .gitleaks.toml` over branch commits | no leaks (`logs/gitleaks.log`) |
| Checkov secrets | `checkov --framework secrets` over service, evidence, migrations | no findings |

## Hard-check traceability

| Hard check | Implementation | Executed test |
|---|---|---|
| All model/provider calls governed through the gateway | Only `ports/provider.ts` adapters are reachable, from `service/gateway.ts`; consumers call the contract | `gateway.test.ts` governed invocation suite |
| Provider/model allowlist | `model_registry`, route filter, `MODEL_NOT_APPROVED` | unapproved pin, other provider, revoked model, no adapter |
| Version pinning | floating tags rejected in request, API and DB CHECK; immutable pins and policy versions (triggers) | floating `latest` 400; DB rejects mutation (`rls-api.int`) |
| Prompt/model/tool audit metadata | `ai_request_metadata` (append-only; hashes, ids, tool and citation ids, counts); outbox `AIRequest*` + `AuditEventSubmitted` | metadata row asserts; no raw values persisted (`rls-api.int`) |
| Data classification / redaction | `domain/redaction.ts`, classification ceilings, purpose/consent port | redaction suite (11 categories), classification and consent tests |
| Tenant/source ACL | `SourceAclPort` default deny, declared source tenant must equal caller tenant | source ACL and cross-tenant source tests |
| Rate/token/cost controls | plugin rate limit, input size, output cap, daily token budget per pin | rate-limit, budget accumulation, input-too-large tests |
| SIMULATED path for CI | `SimulatedModelProvider` with SF-CON-SIMULATION-MARKER | all unit and integration flows |
| Production simulator misuse fails closed | `assertProviderModeAllowed` rejects PRODUCTION/UAT/PREPROD + SIMULATED, REAL, SANDBOX; default OFF with no providers | `guards-config.test.ts` |
| No AI statutory decision | enumerated advisory task kinds; decision kinds refused at registration and by DB CHECK; decision-capable tool effects refused; responses `advisory_only=true`, `statutory_decision=false` (DB CHECK); binding-decision output blocked | registry governance tests; DB constraint tests |

## Tenant isolation / privilege results

- Runtime login role is a member of `sf_app` + `sf_cmp039_rw`; not superuser, not BYPASSRLS, not a table owner (owner is `sf_migrator`).
- `sf_cmp039_rw` is NOLOGIN, NOSUPERUSER, NOBYPASSRLS. PUBLIC has no schema access.
- Peer privilege role (`sf_cmp033_rw` member) cannot DML into `sf_ai_gateway`.
- Runtime cannot UPDATE/DELETE `ai_request_metadata`, cannot DELETE registry rows or change pinned columns.
- FORCE RLS on all six tenant-scoped tables checked via catalog.
- `CROSS_TENANT_LEAKAGE=0`: tenant B sees 0 foreign rows in four tables, 0 rows with no tenant context, cannot invoke/revoke tenant A configuration (404), and a cross-tenant INSERT is rejected by WITH CHECK. Positive control: tenant A sees its own rows.

## Contracts

`contracts/**` and `orchestrator/contracts-lock.yaml` unchanged; 13/13 FROZEN, hash gate passes. No Contract Change Request needed.

## Known limitations / residuals

1. `pnpm-lock.yaml` cannot be committed by builders. `pnpm install --frozen-lockfile` fails on this branch until SF-M04-STITCH-A applies `proposed-lockfile-importer.patch`. Local install used `--no-frozen-lockfile --config.minimumReleaseAge=0` and the lockfile was reverted.
2. Not mounted on the API host (SF-M04-007).
3. No REAL/SANDBOX provider adapter. Production use needs a later task; PRODUCTION + SIMULATED already fails closed.
4. Registry changes are authorized and audited but not yet routed through maker-checker (CMP-051).
5. No response caching; budget check is read-then-act (soft cap under concurrency).
6. Crash between claim and completion leaves an `IN_PROGRESS` idempotency record that returns 409 until expiry (fail closed).
7. Binding-decision output detector is a heuristic, defense in depth only.
8. Independent STITCH/INT/SEC/EVD verification still required; no gate is claimed.
