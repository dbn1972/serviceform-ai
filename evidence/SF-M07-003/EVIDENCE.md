# SF-M07-003 evidence — CMP-023 QR Verification Service

Builder candidate evidence only. **Not CERTIFIED / not G3 / not G6 / not self-certified.** No gate is
issued here; independent INT / SEC / EVD review and a human or CI gate are still required.
Recommended gate status: none (builder candidate).

- Authorization: `HUMAN_M07_THROUGH_EVD_AUTHORIZATION` (Wave A READY on `origin/main` after #143).
- Execution base (exact): `c6f70f190b08f876a793d9f3401c50fecdbe8058` (`logs/execution-base.txt`).
- Branch: `cursor/m07-003-qr-91f2`, dedicated worktree. No PR opened by the builder; not merged.
- Implementation commit the logs were produced on: `6160e9989378f255f179043492386a2c5ca9cbc2`
  (`logs/impl-head.txt`). Later commits add only this evidence directory and the handover.
- Agent / model: Cursor Cloud Agent, `serviceform-credential-builder`, route `opus`, release
  `claude-opus-5-5`. Self-assessment is not evidence.

## What was built
`@serviceform/cmp-023-qr-verification` (`services/cmp-023-qr-verification`), schema `sf_qr`,
privilege role `sf_cmp023_rw`, migrations `1760380300000_cmp-023-qr-verification.sql` and
`1760380300001_cmp-023-outbox.sql` (SF-CON-OUTBOX template, documented substitutions only).
Routes (`createQrApi`, `ROUTE_DESCRIPTORS`): `POST /v1/qr/tokens`, `GET /v1/qr/tokens/{token_id}`,
`GET /v1/qr/verify/{opaque_token}`. Event on `sf.qr.events.v1`: `VerificationTokenIssued`; audit on
`sf.audit.ingest.v1`.

## Executed checks (logs in `logs/`)
| Check | Result | Log |
|---|---|---|
| tsc `--noEmit` (package incl. tests) | exit 0 | `typecheck.log` |
| ESLint `--max-warnings=0` (package) | exit 0 | `eslint.log` |
| Prettier `--check` (package; handover checked separately) | exit 0 | `prettier.log` |
| Unit + contract (vitest) | 62/62 pass (14 domain/input, 32 service/API incl. 9 tenant-negative, 16 contract/static) | `unit-contract.log`, `junit/unit.xml` |
| Integration on PostgreSQL 16.15 (full migration chain, real LOGIN roles, FORCE RLS) | 13/13 pass (9 privilege/RLS/DB-guard/reversibility, 4 API flow) | `integration-postgres16.log`, `junit/integration.xml` |
| Repo gates `scripts/gates/run_all.py` | 10/10 PASS | `gates.log` |
| Write scope `check_scope.py --envelope orchestrator/handovers/SF-M07-003.yaml` | PASS, 0 errors | `scope.log`, `write-scope-diff.txt` |

Commands (from `services/cmp-023-qr-verification`): `tsc --noEmit -p tsconfig.json`;
`vitest run --root . --config vitest.unit.config.ts`;
`DATABASE_URL=… vitest run --root . --config vitest.integration.config.ts` (throwaway local
database; credentials not recorded). Mutation spot-checks (not in logs): adding a status cache to
verify fails 2 tests; leaking `credential_id` into `public_view` fails 6 tests. CI-only checks
(CodeQL, Semgrep, gitleaks, checkov, coverage thresholds, dependency-cruiser) were not run on the
builder VM.

## Requirement → test traceability
- **SF-CON-VERIFICATION-TOKEN conformance**: `contracts.test.ts` validates every returned token (mint, re-mint, issuer read) against the frozen schema; public verify body against the frozen `#/properties/public_view`; frozen valid + both invalid examples; constants equal frozen bounds and the CMP-024 status enum; OpenAPI schemas accept handler output.
- **Opaque token**: 32 random bytes base64url, no encoded ids (`domain.test.ts` "opaque token"); never in outbox/audit (`service.test.ts`, `contracts.test.ts`, `api-flow.int.test.ts` SQL scan); DB CHECK on format (`privilege-rls.int.test.ts`).
- **registry_status read-only from CMP-024, never written or cache-overridden**: live read per response, revocation visible immediately, outage fails closed right after a success, malformed/inconsistent/foreign answers fail closed, replay re-renders live status and stores only `token_id` (`service.test.ts`); status-supplying requests refused `STATUS_WRITE_FORBIDDEN`; registry fake unchanged by any flow; static guards: port has only `getStatus`, repository has no status method, no status column (`contracts.test.ts`); DB column inventory (`privilege-rls.int.test.ts`).
- **No PII in public_view**: closed key set, no tenant/token/credential id or token in the public body (`domain.test.ts`, `service.test.ts`, `contracts.test.ts`); unknown (PII-shaped) input fields refused.
- **Tenant isolation (tenant-negative)**: foreign-tenant verify/read/mint are 404 with no existence leak; leaked foreign credential/registry records blocked 403 and audited; tenant headers/body refused; tenant-less context refused; same credential id in two tenants independent; PEP input tenant-bound (`service.test.ts` "tenant-negative"); FORCE RLS read/write isolation and tenant-less sessions on real PostgreSQL (`privilege-rls.int.test.ts`, `api-flow.int.test.ts`).
- **Idempotent side effects**: Idempotency-Key replay, re-mint returns existing token, conflicting terms 409, failed commit leaves nothing; concurrent mints converge on one row on PostgreSQL.
- **No network in DB transactions / OPA / audit**: `TxProbe` asserts no port call during a transaction; PDP denial audited `DENIED`, outage 503; post-authorization refusals audited `FAILED`; envelopes validate against shared schemas.
- **Privilege posture**: `sf_cmp023_rw` NOLOGIN NOSUPERUSER NOBYPASSRLS; sf_migrator owner; SELECT/INSERT only on tokens; insert-only trigger; peer role denied; reversible migration pair (`privilege-rls.int.test.ts`).
- **No invented policy**: no validity/retention period, no statutory or named-service vocabulary (static test); `expires_at` only from the minting caller.

## Scope
`logs/write-scope-diff.txt` lists every committed path changed against the execution base. 0 lines
changed in `pnpm-lock.yaml`, `apps/**`, `contracts/**`, `orchestrator/contracts-lock.yaml`,
`specs/**`, `policy/**`, `infra/**` or sibling M07 service paths.

## Incident (for the orchestrator)
Concurrent Wave A builders initially shared the `/workspace` checkout. This lane's first commit
(`e484396`) landed on `cursor/m07-004-digilocker-da99` after a sibling switched HEAD; SF-M07-004
then committed `b83e897` on top and pushed. The same content is on this branch as `90ce687`; all
later work used a dedicated worktree. The SF-M07-004 branch was not modified by this lane.
