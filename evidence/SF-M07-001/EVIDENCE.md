# SF-M07-001 evidence (CMP-022 Credential Engine)

Builder evidence only. Not CERTIFIED. Not RELEASE CERTIFIED. Not G3. Not G6. Do not merge.
Builder self-assessment is not verification; independent review/INT/SEC remain required.

| Field | Value |
|---|---|
| Task | SF-M07-001 |
| Component | CMP-022 (INT-008, INT-011, INT-013) |
| Authorization | `HUMAN_M07_THROUGH_EVD_AUTHORIZATION` (Wave A READY on main after #143) |
| Branch | `cursor/m07-001-credential-91f2` |
| Base (exact, verified) | `c6f70f190b08f876a793d9f3401c50fecdbe8058` (merge of #143) |
| Implementation commit | `f63691f15b26aded051b8a2d73e7655f7065c243` (schema `07dd78aa`, service `f63691f1`) |
| Schema / role | `sf_credential` / `sf_cmp022_rw` (NOLOGIN, no BYPASSRLS) |
| Model / effort | claude-opus-5-5 / high (route `opus`) |
| CCR | false (no frozen contract or contracts-lock change) |
| Lockfile | not committed (see residual) |

## Executed results at `f63691f1`

Local VM: Node 22.14.0, pnpm 10.28.0, PostgreSQL 16.15 (private throwaway cluster, see residual 4).

| Suite | Result | Artifact |
|---|---|---|
| Unit + tenant-negative + contract (vitest) | 145/145 PASS (domain 40, issuance 79, tenant-negative 12, contract 14) | `junit/unit.xml` |
| PostgreSQL integration (runtime login `sf_app + sf_cmp022_rw`) | 10/10 PASS (also 3 consecutive runs on the shared cluster) | `junit/integration.xml` |
| Unit coverage `src/**` (excludes PG-only paths exercised by integration) | stmts 83.36%, branches 80.47%, funcs 76.64%, lines 85.22% | local v8 |
| `tsc --noEmit` | PASS | — |
| `eslint --max-warnings=0` (service) | PASS | — |
| `prettier --check` (service, handover) | PASS | — |
| `scripts/gates/run_all.py` (10 gates; 34 contracts FROZEN) | all PASS | — |
| `scripts/gates/tests` (pytest) | 30/30 PASS | — |
| `migration_lint.py` | PASS (84 files) | — |
| `check_scope.py --envelope orchestrator/tasks/SF-M07-001.yaml` | PASS (47 files) | — |
| `pnpm db:test` (shared migration/isolation harness) | 17/17 PASS | — |
| Migrations up → down 2 → up (`--check-order`) | PASS | — |
| semgrep 1.180.0 (p/default, p/typescript, p/nodejsscan, p/secrets, .semgrep/) on lane paths | 0 findings (334 rules, 47 files) | — |
| checkov 3.3.29 `--framework secrets` on lane paths | PASS | — |

## What the tests prove (requirement → test)

| Requirement | Evidence |
|---|---|
| Credential and signing record conform to FROZEN SF-CON-CREDENTIAL / SF-CON-SIGNING-RECORD; schema hashes unchanged vs lock; frozen examples valid/invalid as declared | `test/contract/contracts.test.ts` |
| Forward-only GENERATED → SIGNED → ISSUED; reversal, skip, provenance edits, deletes and late artifact/signing inserts refused by DB (`55000` / `42501`) and code | `domain.test.ts`, `issuance.test.ts`, `credential-pg.int.test.ts` |
| No approval decision: approval ref must already be on the case; `approval_decision_by_this_component = false` (CHECK); client authority/time keys refused | `issuance.test.ts` |
| Artifact stored as storage-key + SHA-256 only; SIGNED requires a SIGNED attempt whose hash matches the signed artifact | `issuance.test.ts`, `credential-pg.int.test.ts` |
| Idempotent `issuance_key`: repeat → same credential (200); 3 concurrent requests converge on one credential and one issued event; FAILED signing then retry uses the next attempt | `issuance.test.ts`, `credential-pg.int.test.ts` |
| INT-013 modes: SIMULATED needs a marker bound to binding + deployment env; refused in PRODUCTION (code and CHECK `23514`); default env PRODUCTION | `domain.test.ts`, `issuance.test.ts`, `credential-pg.int.test.ts` |
| ISSUED only after CMP-024 ack REGISTERED/ACTIVE; registry outage → 503 and stays SIGNED, retry resumes | `issuance.test.ts` |
| Publish/notify failure does not reverse issuance: FAILED DIGILOCKER_PUBLISH outcome recorded, credential stays ISSUED, `issuance_reversed = false` | `issuance.test.ts`, `credential-pg.int.test.ts` |
| No external I/O in DB txn: TxProbe 0 violations; `NETWORK_IN_TX` guard | `issuance.test.ts` |
| Tenant negative: wrong-tenant read/list/issue/outcome denied; no-tenant sees 0 rows; peer component login denied; producer cannot read outbox; CROSS_TENANT_LEAKAGE = 0 | `tenant-negative.test.ts`, `credential-pg.int.test.ts` |
| ADR-0006: NOLOGIN role, no BYPASSRLS, `sf_migrator` owner, FORCE RLS on 7 tenant tables; isolation.json matches migration | `credential-pg.int.test.ts`, `contracts.test.ts` |
| OPA PEP: deny / PDP outage fail closed before any port or write | `issuance.test.ts` |
| Outbox/audit envelopes validate against SF-CON-EVENT-ENVELOPE / SF-CON-AUDIT-EVENT; outbox migration embeds SF-CON-OUTBOX template | `contracts.test.ts`, `issuance.test.ts` |

## Residuals (for independent review; not waived by builder)

1. Lockfile admission residual (same as SF-M06-001): `services/cmp-022-credential-engine` has no
   `importers` entry in `pnpm-lock.yaml`; the lockfile is not owned by this lane and was not modified.
2. Port adapters (case pins, render, CMP-037 signing via INT-013, CMP-024 registry) are unbound here
   and fail closed; binding is host/STITCH scope (SF-M07-005). The port shapes in
   `contracts/ports/` are component-local; promotion to a shared contract needs a CCR.
3. No DigiLocker/eSign policy was assumed: which channels are mandatory, retry cadence for publish,
   and signer/certificate policy are outside this component and need policy input before host wiring.
4. `pnpm db:test` on the shared VM cluster failed only at `down 84` because another lane's database
   (`sf_m08_005`) holds objects owned by cluster-wide role `sf_cmp013_rw`. The 17/17 result above is
   from a private PostgreSQL 16.15 cluster with only this branch's migrations.
5. `migrateDown(2)` in the integration test assumes CMP-022 migrations are the latest applied; a later
   sibling migration with a higher timestamp would require adjusting the count at STITCH.
6. Real-CI exact-head run IDs are recorded once a draft PR CI runs (no PR opened by this lane).
