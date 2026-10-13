# SF-M08-INT evidence — independent integration stitcher

**Not CERTIFIED. Not G3. Not G6. self_certified false. Recommend only.**

| Field | Value |
|---|---|
| Task | SF-M08-INT |
| Branch | `cursor/m08-int-sf-m08-int-91f2` |
| Base | `50a4ed3ad474a6a1395de98c9937a50f23045cfb` (host #136 merge on main) |
| Tests commit | `5f836dad95bdeebd7fb4ad8a553bb710768e3d95` |
| Run | `local-vitest-2026-10-13T15:27:49Z` (vitest 5.0.3, node, no PostgreSQL) |
| Model | route `opus`, release `claude-opus-5-5` |
| Suites | INT-003 discovery · INT-010 events/index/ops · INT-011 host · INT-013 modes |
| Local vitest | **36/36 PASS** (11 + 11 + 6 + 8) |
| eslint / prettier | PASS / PASS (`logs/eslint.log`, `logs/prettier.log`) |
| Production code modified | **false** (`git diff 50a4ed3 -- services apps` empty) |
| CROSS_TENANT_LEAKAGE | **0** |

Command: `npx vitest run --config tests/integration/m08/vitest.config.ts`
Artifacts: `junit/independent-unit.xml`, `logs/vitest.log`.

## What is exercised

All host tests go through `apps/api` `buildApp` (CMP-036 gateway + `composition/m08.ts`). Services
are the real owner implementations; only persistence and peer read ports are independent
in-memory doubles in `tests/integration/m08/support/` (owner test doubles are not reused).

| INT | Seam | Key assertions |
|---|---|---|
| INT-003 | host → CMP-006 discovery (real service) | pinned PUBLISHED catalogue only; results `result_is_non_statutory`, `draft_created=false`; selection is the only hand-off and emits `DiscoveryServiceSelected` intent only; Idempotency-Key required + replay; owner-only citizen select; DRAFT pin refused; T2 cannot use T1 pin or read T1 query; leaked foreign search hit → SF-TEN-002 with nothing persisted; PDP outage → 503; event-envelope + audit-event contracts validate |
| INT-010 | host → CMP-046 ops (real service); CMP-046 `OpsViewRefreshed` → CMP-035 `SearchIndexConsumer` (real) | bound port → OK snapshot `non_authoritative`; unbound port → UNAVAILABLE/PORT_UNBOUND (never fabricated healthy); refresh idempotent; T2 never sees T1 snapshot, ports called with server tenant; citizens refused; indexer stores only declared facets under event tenant, duplicate delivery no-op, T1/T2 partitions disjoint, no rule → SKIPPED; CMP-045 replay unbound → SF-INT-001 |
| INT-011 | host admission | six M08 mounts in order CMP-035/007/045/046/049/006; CMP-036 once; every read route served with server-derived tenant only; forged `X-Tenant-ID`/`x-tenant` on 12 read+write routes → SF-TEN-002, error-response valid, no canary, no service call; body `tenant_id` not adopted; M06 coexists |
| INT-013 | M08 SIMULATED / unbound ports | CMP-035 `SimulatedProjectionRules` allowed in LOCAL/CI/DEVELOPMENT/SIT/PERFORMANCE, refused in UAT/PREPROD/PRODUCTION (SF-SYS-003), indexer construction refuses it in PRODUCTION; invalid SF_ENVIRONMENT rejected; `connector_mode` enum enforced; CMP-045/CMP-046 unbound defaults reject |

## Honest boundaries (not exercised here)

- PostgreSQL RLS / privilege roles for M08 schemas (owner `*.int.test.ts`; not run in this envelope).
- OpenSearch, CMP-038 bus delivery and replay history, owner summary adapters (CMP-017/029/037/038/047).
- CMP-007 recommendation beyond the deny-by-default host seam; CMP-049 retention beyond host seam
  (statutory retention periods remain policy input — none invented).
- M08 has no SIMULATED critical connector other than CMP-035 projection rules; no REAL/SANDBOX
  connector validation is claimed.

## Findings

None against owning components.

## Process note

The shared `/workspace` checkout was switched to `cursor/m08-sec-sf-m08-sec-91f2` by the
concurrent SF-M08-SEC agent during this run, so the first test commit landed there locally
(never pushed). It was cherry-picked onto this branch as `5f836da…` in a dedicated worktree, the
SEC branch was restored to its pushed tip `40c7783…`, and the evidence was re-run from the
worktree. `logs/check_scope.log` is PASS against this envelope.

## Certification stance

CERTIFIED=false · G3=false · G6=false · recommended_result `SF_M08_INT_PASS` (for human/CI gate).
