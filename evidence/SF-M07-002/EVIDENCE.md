# SF-M07-002 evidence — CMP-024 Credential Registry / Revocation

Builder candidate evidence only. **Not CERTIFIED / not G3 / not G6 / not self-certified.** No gate is
issued here; independent INT / SEC / EVD review and a human or CI gate are still required.
Recommended gate status: none (builder candidate).

- Authorization: `HUMAN_M07_THROUGH_EVD_AUTHORIZATION`; Wave A READY on `main` after #143.
- Execution base: `c6f70f1` (`origin/main`, merge of #143). Branch `cursor/m07-002-registry-91f2`.
  No PR opened by the builder; not merged.
- Implementation commit the logs were produced on: `3de0130` (`logs/impl-head.txt`), parent `c6f70f1`.
  Logs were produced in a dedicated worktree of this branch (the shared VM checkout is used by other
  M07 lanes) against a freshly created PostgreSQL database; the migration chain contained no
  sibling M07 migrations. Later commits add only this evidence directory and the handover.
- Agent / model: Cursor Cloud Agent, route `opus`, release `claude-opus-5-5` (per
  `MODEL-ROUTING-QUALITY.md`; self-assessment is not evidence).

## What was built
- Package `@serviceform/cmp-024-credential-registry` (no runtime dependencies), schema
  `sf_credential_registry`, role `sf_cmp024_rw` (NOLOGIN, NOBYPASSRLS), FORCE RLS on every tenant table.
- Owns `REGISTERED/ACTIVE/SUSPENDED/REVOKED/REISSUED` under FROZEN `SF-CON-CREDENTIAL-STATUS`
  (consumed, not modified). History is append-only: insert-only trigger, no UPDATE/DELETE grant, and a
  guard requiring each history row to match the entry version and status it records.
- Lifecycle enforced in the domain and again by `guard_entry()`; REVOKED and REISSUED are terminal;
  REISSUED requires a live successor in the same tenant registry.
- Suspend/revoke require `reason_code_ref` (opaque metadata ref; free text refused; DB CHECK). No
  statutory grounds, validity periods or eSign/DigiLocker policy defined.
- Read port (`GET …/status`, `createCredentialStatusReadPort`) cannot mutate status: no body or query
  accepted, typed against a mutator-free `CredentialStatusReader`, executed in `BEGIN READ ONLY`.
- `createRegistryApi` + `ROUTE_DESCRIPTORS` (each route tagged `READ` or `COMMAND`); OPA PEP before
  any transaction; denials audited; PDP outage fails closed; idempotent commands; outbox events
  `CredentialRegistered`/`CredentialStatusChanged` + audit in the same transaction.

## Executed checks (logs in `logs/`)
| Check | Result | Log |
|---|---|---|
| tsc `--noEmit` (package) | exit 0 | `typecheck.log` |
| ESLint `--max-warnings=0` + Prettier `--check` (package) | exit 0 | `lint.log` |
| Unit + tenant-negative + contract (vitest 5.0.3) | 85/85 pass (29 domain, 22 service/API, 9 read-port, 8 tenant-negative, 17 contract) | `unit.log`, `junit/unit.xml` |
| Integration on PostgreSQL 16.15 (fresh DB, full migration chain, real LOGIN roles) | 9/9 pass (API flow, RLS, no-tenant, immutability, DB guards, peer role denied, READ ONLY tx, ownership/FORCE RLS, up→down→up) | `integration.log`, `junit/integration.xml` |
| Repo gates `scripts/gates/run_all.py` | 10/10 PASS | `gates.log` |
| Write scope `check_scope.py --envelope orchestrator/handovers/SF-M07-002.yaml` | PASS |  `scope.log` |

Commands (from `services/cmp-024-credential-registry`): `tsc --noEmit -p tsconfig.json`;
`vitest run --root . --config vitest.unit.config.ts`;
`DATABASE_URL=… vitest run --root . --config vitest.integration.config.ts`.
CI-only checks (CodeQL, Semgrep, gitleaks, checkov, coverage thresholds, dependency-cruiser) were not
run on the builder VM.

## Requirement → test traceability
- Status ownership + contract shape: `contracts.test.ts` validates every returned document (all five statuses) against the frozen schema; status enum and reason-required set equal the frozen schema.
- Immutable history: `service.test.ts` "appends one immutable entry per change", "never rewritten"; `privilege-rls.int.test.ts` "history is immutable and entries are never deleted", "database guards … mismatched history".
- Read ports never mutate: `read-port.test.ts` (read-only tx, repeated QR reads, body/query refused, non-GET refused, frozen port, mutator-free view); `privilege-rls.int.test.ts` "READ ONLY at the database" (25006); `contracts.test.ts` read-only posture.
- Revoke/suspend reason refs: `service.test.ts` "require a reason_code_ref; free text is refused"; DB CHECK in `privilege-rls.int.test.ts`.
- Tenant isolation: `tenant-negative.test.ts` (cross-tenant read/suspend/revoke/reissue → 404 with no change, successor in other tenant invisible, tenant headers/body refused, tenant-scoped idempotency); `privilege-rls.int.test.ts` RLS/no-tenant/peer role.
- No invented policy / boundary: `contracts.test.ts` "policy invention guard", no peer imports, no network calls, own schema only.

## Scope
0 lines changed in `pnpm-lock.yaml`, `apps/**`, `contracts/**`, `orchestrator/contracts-lock.yaml`,
`specs/**`, `policy/**`. Frozen contracts unaltered; `ccr_required=false`.

## Residuals (explicit)
1. `EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL` — the new workspace package needs an importer row in `pnpm-lock.yaml` (not modified here).
2. OPA policy data for `CREDENTIAL_REGISTRY_*` actions lives in `policy/**` (read-only for this lane); until added the PDP denies (fail-closed).
3. `reason_code_ref` is opaque; approved tenant reason-code metadata and its resolution are not provided here.
4. Maker-checker (CMP-051) for revoke/suspend is not wired; restricted to OFFICER/PRIVILEGED_ADMIN/SYSTEM + OPA.
5. CMP-022 → CMP-024 registration hand-off and CMP-023 read-port wiring happen at host mount (SF-M07-005) / INT.
