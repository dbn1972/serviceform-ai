# SF-M08-001 evidence — CMP-035 Search & Indexing (CG-02 Wave A)

**Not CERTIFIED. Not VERIFIED. Not G3. Not G6.** Builder self-certification is false. **DO NOT MERGE**
without separate authorization. STITCH-A / host (SF-M08-007) / INT / SEC / EVD not started.

| Field | Value |
|---|---|
| Task | SF-M08-001 (CMP-035; INT-010, INT-011) |
| Authorization | `HUMAN_CG_02_WAVE_A_DISPATCH_AUTHORIZATION` |
| Dispatch base | `8b1c26ceb1fd781eab55a34fdc17d376dcc03c1b` (exact `origin/main`; guard in `pre-dispatch-guard.json`) |
| Branch | `agent/M08-search-SF-M08-001` |
| Implementation commit | `7c50057d` (`logs/impl-sha.txt` has the full SHA) |
| Frozen contracts | 29/29 MATCH; none altered; `CCR_REQUIRED=false` |
| `pnpm-lock.yaml` | not committed; `EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL` (`logs/lockfile-residual.log`) |
| Task envelope | `orchestrator/tasks/SF-M08-001.yaml` unmodified |

## Scope delivered

- `services/cmp-035-search-indexing/**`: projection consumer (`SearchIndexConsumer`), tenant-scoped
  query service (`SearchQueryService`), HTTP routes, Postgres store, ports (OPA authorization,
  projection-rule metadata), component-local OpenAPI/AsyncAPI/isolation/topics declarations.
- `db/migrations/1759600350000_cmp-035-search-indexing.sql`: `sf_search`, `sf_cmp035_rw` NOLOGIN,
  `search_document` ENABLE+FORCE RLS via `sf_platform.current_tenant_id()`, guard trigger (no delete,
  immutable source identity, revision +1, source_version strictly increasing), column-scoped UPDATE.
- `db/migrations/1759600350001_cmp-035-outbox.sql`: SF-CON-OUTBOX template verbatim (`sf_search`,
  `CMP-035`).

## Architecture constraints and how they are evidenced

| Constraint | Evidence |
|---|---|
| Search is projection only | Rows hold declared facets + source refs; no write-back path; raw payload discarded (`indexer.test.ts`, `indexing-flow.int.test.ts` assert the undeclared field never appears) |
| Source / version retained | `source_cmp_id`, `source_record_id`, `source_aggregate_type`, `source_event_id`, `source_version`, projection `rule_id`/`rule_version` stored and returned in hits |
| Idempotent, monotonic indexing | Inbox `cmp-035.indexer` dedupe → `DUPLICATE`; older/equal source version → `STALE`; trigger rejects regression (`privilege-rls.int.test.ts`) |
| Tenant-safe indexing | Session tenant = envelope tenant; platform events skipped; deterministic id per tenant; FORCE RLS; explicit `tenant_id = $1`; cross-tenant result guard (`SF-TEN-002`) |
| `CROSS_TENANT_LEAKAGE=0` | `logs/integration-postgres.log`: `EVIDENCE SF-M08-001 CROSS_TENANT_LEAKAGE=0 returned=10 tenants=2 per_tenant=5` |
| Events via CMP-038 | Consumer handler for CMP-038 deliveries + SF-CON-OUTBOX producer; no broker client in CMP-035 |
| No sibling SQL | `no-named-branching.test.ts` scans source for foreign `sf_*` schemas and sibling imports; migration test applies on baseline + shared contracts only |
| Metadata-driven, no named branching | Topics/aggregates/event types/facets come from `ProjectionRulePort`; static scan for named CMP/topic/event literals |
| No network I/O in DB txn | Ports guarded by `guardOutboundPort`; `NETWORK_IO_IN_DOMAIN_TX` test; rule resolution asserted outside txn |
| INT-013 | `SimulatedProjectionRules` / SIMULATED authorizer refused in PRODUCTION and non-simulation environments (UAT tested) |
| Frozen SF-CON-SEARCH-DOCUMENT | AJV validation of emitted and returned documents against the frozen schema; lock hash re-checked |

## Commands (executed, all exit 0)

```bash
pnpm install --frozen-lockfile          # lockfile restored afterwards; not committed
pnpm format:check && pnpm lint && pnpm typecheck
pnpm test:coverage                      # 1521/1521; repo thresholds met
(cd services/cmp-035-search-indexing && pnpm exec vitest run --config vitest.unit.config.ts)  # 89/89 unit + contract
(cd services/cmp-035-search-indexing && DATABASE_URL=… pnpm exec vitest run --config vitest.integration.config.ts)  # 15/15, PostgreSQL 16.15
DATABASE_URL=… pnpm db:test             # 17/17 full migration chain up/down + RLS harness
pnpm contracts:validate && pnpm test:cdc && pnpm deps:graph && pnpm build
python3 -m pytest scripts/gates/tests -q   # 30/30
python3 scripts/gates/run_all.py           # 10/10 PASS
python3 scripts/gates/check_scope.py --envelope orchestrator/tasks/SF-M08-001.yaml --base origin/main  # PASS
```

Logs: `logs/`. JUnit: `junit/`. Summary: `gates-summary.json`.

## Residuals (not blockers for this builder candidate)

- `EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL`: importer row `services/cmp-035-search-indexing: {}` is
  admitted by STITCH-A, not by this lane.
- Service integration tests run on the builder VM (PostgreSQL 16.15); CI's `database` job runs the
  repo harness (`pnpm db:test`) which applies these migrations up/down but not the service-local suites.
- Projection rules are a port; the published-metadata adapter (CMP-033/052) and host mount are
  SF-M08-007 / STITCH scope. No OpenSearch adapter in this slice (connector binding + INT-013 later).
- Facet PII classification relies on published projection metadata declaring only non-PII facets;
  CMP-035 enforces declared-only, bounded scalars. Semantic-registry classification is later scope.
- Rerunning `evidence/CG-02-WAVE-A-ACTIVATION/pairwise_write_path_uniqueness.py` on the dispatch base
  reports a stale seven-lane assertion against the guardian-corrected module-local lists (see
  `pre-dispatch-guard.json`); overlaps 0, forbidden writers 0. Not modified (outside write scope).
