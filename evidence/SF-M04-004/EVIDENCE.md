# SF-M04-004 builder evidence — CMP-013 Document Upload (not CERTIFIED)

| Field | Value |
|---|---|
| Task | SF-M04-004 (M04 Wave A, LOCK-2) |
| Component | CMP-013 |
| Integrations | INT-011, INT-013 (component-level only; independent re-verify is SF-M04-INT / SF-M04-SEC) |
| Base | `origin/main` `9ccc2b02f8ef64a0987b0c4793137511545ed3f7` |
| Implementation commit | `12c4bf92e511ddc7c233ac824ad05bcc5f004227` |
| Branch / PR | `cursor/sf-m04-004-document-upload-6404` / dbn1972/serviceform-ai#72 (draft) |
| Builder model | claude-opus-5-5 (high), Cursor cloud agent |
| Recommended gate | DEVELOP complete; VERIFY pending STITCH-A lockfile + independent INT/SEC/EVD |
| CERTIFIED / RELEASE CERTIFIED / G6 | **false** / **false** / **false**. M05 OFF |

## Local execution (agent VM, PostgreSQL 16.15, Node 22, pnpm 10.28.0)

| Command | Result |
|---|---|
| `pnpm --filter @serviceform/cmp-013-document-upload run test:unit` | 66 / 66 pass (`junit/unit.xml`) |
| `DATABASE_URL=… pnpm --filter @serviceform/cmp-013-document-upload run test:integration` | 11 / 11 pass (`junit/integration.xml`) |
| `pnpm test:coverage` (root, all workspaces) | 140 files / 591 tests pass; lines 86.73, statements 83.3, functions 89.87, branches 70.93 (thresholds 80/80/80/70) |
| `pnpm db:test` | 17 / 17 pass (empty-DB up, roles, FORCE RLS, full down/up round trip) |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build` | pass |
| `pnpm contracts:validate` / `pnpm test:cdc` / `pnpm deps:graph` | 12 contracts 0 failures / 19 pass / 0 violations |
| `python3 scripts/gates/run_all.py` + gate self-tests | 10 gates PASS; 25 self-tests pass |
| `python3 scripts/gates/contracts_lock_gate.py` | 13 in lock, 13 FROZEN, PASS |
| `python3 scripts/gates/check_scope.py --envelope orchestrator/tasks/SF-M04-004.yaml --base 9ccc2b0` | 52 files, PASS |
| `python3 scripts/gates/migration_lint.py` | PASS |
| `semgrep 1.179.0` (p/default, p/typescript, p/nodejsscan, p/secrets, `.semgrep/`) on changed paths | 334 rules, 0 findings |
| `gitleaks 8.30.1 git --log-opts 9ccc2b0..HEAD` | no leaks |

Local linking note: `pnpm install` cannot resolve a new importer offline under `minimumReleaseAge`, so the
component's `node_modules` was symlinked locally to the exact versions already locked for CMP-001
(`fastify 5.12.5`, `pg 8.23.1`, `@types/pg 8.23.1`). `pnpm-lock.yaml` was **not** modified or committed.

## Hard checks

| Check | How it is enforced | Test evidence |
|---|---|---|
| CMP-032 via approved interface only | `DocumentStoragePort`; SIMULATED adapter built on `@serviceform/storage` (`SimulatedObjectStore`, presign, marker, `buildObjectKey`) | contract test: no `cmp-032-storage` import, no `sf_storage.` SQL; depcruise 0 violations |
| Tenant-safe sessions / object refs | FORCE RLS on all tenant tables; server-derived context; port refuses keys not prefixed `t/{tenant}/` | `privilege-rls.int.test.ts` (wrong-tenant 0 rows, WITH CHECK 42501), `api-flow.int.test.ts` (404 + no canary), port `OBJECT_NOT_OWNED` |
| Checksum / integrity | declared SHA-256 + size + sniffed signature vs observed object; integrity columns immutable after `SCAN_PENDING` (trigger) | checksum/size/type mismatch tests (unit + PG) |
| MIME/type/size policy (metadata) | `upload_policy` versions; only signature-verifiable types allowed; missing/retired policy fails closed | policy fail-closed tests |
| Traversal-safe object keys | `isSafeObjectKey` + DB CHECK `^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$`, length ≤ 512; keys from UUIDs only; filename never accepted | domain `it.each` unsafe keys; PG CHECK 23514 |
| No durable local/pod filesystem | in-process `SimulatedObjectStore` only; no `fs` import in `src` | contract static check |
| No raw provider credentials | ports return presigned targets only; no SDK/keys in source; URLs not persisted in outbox/idempotency | contract static check; PG outbox/idempotency scans |
| No OCR | none in source (SF-M04-006) | contract static check |
| INT-013 mode / fail closed | SIMULATED adapters refuse PRODUCTION/UAT/PREPROD; plugin refuses SIMULATED critical in PRODUCTION and SIMULATED without marker | INT-013 unit tests |
| Malware scan fail closed | `AVAILABLE` only after CLEAN (service + DB trigger); outage → RETRY → `SCAN_FAILED`; INFECTED → discard | scan unit tests; PG guard test |
| No network call inside DB transaction | `UploadService.external` throws if a tx is open (AsyncLocalStorage); probe records `inTx` per port call | probe tests (unit + PG): 0 in-transaction calls |

## Database (ADR-0006)

- `sf_cmp013_rw`: NOLOGIN, NOSUPERUSER, NOBYPASSRLS. `sf_migrator` owns all 9 `sf_upload` tables.
- Runtime login (test: `sf_t013u_rt` ∈ `sf_app`, `sf_cmp013_rw`) is not the owner and cannot `SET ROLE sf_migrator` or a peer `_rw`.
- Peer login (`sf_cmp048_rw`) is denied with 42501.
- UPDATE on `document_metadata` is granted only on the status, integrity and scan columns. There is no DELETE.
- **CROSS_TENANT_LEAKAGE = 0**: covers direct queries, canary scans, and API 404s that never echo the T2 id or canary.

## Residuals

1. **Blocking for CI SUCCESS (structural, outside this envelope):** `pnpm-lock.yaml` has no importer for
   `@serviceform/cmp-013-document-upload`. As a result, `pnpm install --frozen-lockfile` fails in every CI job that installs dependencies. Owner: SF-M04-STITCH-A (LOCK-3). Same precedent as PR #51.
2. Host mount, scan-worker subscription and sweeper scheduling are deferred to SF-M04-007.
3. There is no REAL S3/KMS/GuardDuty adapter. That requires ADR-STORAGE-INFRA, and production stays fail-closed until then.
4. Integration evidence comes from a local PostgreSQL run. The CI `database` job does not run component `*.int.test.ts` suites. Independent re-verification is SF-M04-INT / SF-M04-SEC.
