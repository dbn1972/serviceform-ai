# SF-M01-004 evidence (CMP-038 Event Bus)

> **SUPERSEDED — not VERIFIED.** Cursor-host captures below are provenance-invalid for M01 Wave 1 gates (F-V5-002). See [`SUPERSEDED.md`](./SUPERSEDED.md) and [`../m01-w1-remediation/INDEX.md`](../m01-w1-remediation/INDEX.md). Replacement evidence must come from GitHub job `m01-envelope-int`.

| Field | Value |
|---|---|
| Task | SF-M01-004 |
| Component | CMP-038 Event Bus / Messaging Platform |
| Integrations | INT-011, INT-013 |
| Branch | `agent/M01-cmp-038-event-bus-SF-M01-004` |
| Base | `origin/main` `8a4695d62a065fd3e8047b0c49085bfebbb0c513` |
| Tested commit | `a4619be2d7111449d2de944399940ff66e4c2e7c` (src + tests). Evidence/handover committed after this SHA. |
| Envelope model | opus / high (requested) |
| Actual model | Cursor cloud agent, `originalModelName: default` (Composer) |
| Effort | high |
| Environment | CI-equivalent Linux; PostgreSQL 16 on `127.0.0.1:5432`; Kafka 4.1.0 KRaft tarball `/var/tmp/kafka/kafka_2.13-4.1.0`; Node 22.22.3; `SF_ENVIRONMENT=CI` |
| Connector modes | REAL Kafka 4.1.0 for K1–K5 / 004-29; SIMULATED in-memory transport only under D-04 (`CI`) |
| Produced by | serviceform-foundation-builder. **Not certified. Not merged.** |

## Commands and results

| Command | Result |
|---|---|
| `pnpm exec vitest run packages/outbox/test services/cmp-038-event-bus/test` | PASS 22 unit tests / 9 files |
| `pnpm --filter @serviceform/cmp-038-event-bus test:integration` | PASS 46 tests / 7 files (includes K1–K5 real Kafka) |
| Combined coverage run (unit + integration) | PASS 68 tests / 16 files; lines **80.69%** (577/715) on `packages/outbox/src/**` + `services/cmp-038-event-bus/src/**` |
| `python3 scripts/gates/check_scope.py --envelope orchestrator/tasks/SF-M01-004.yaml --base origin/main` | PASS |
| `pnpm gates` | PASS 7/7 |
| `pnpm --filter @serviceform/outbox --filter @serviceform/cmp-038-event-bus typecheck` | PASS |
| `pnpm exec eslint --max-warnings=0 packages/outbox services/cmp-038-event-bus` | PASS |
| `pnpm deps:graph` | PASS (120 modules, 229 deps) |
| `pnpm add kafkajs@2.2.4` with default `trustPolicy` | Not used to rewrite the lockfile. `kafkajs@2.2.4` was fetched as the npm tarball (MIT, `dependencies: {}`) and linked locally for tests. `pnpm-lock.yaml` was not committed. |
| gitleaks / semgrep | Tools not installed in this environment; not executed |

## Hard-gate observations (builder-recommended only)

| Gate | Observation |
|---|---|
| frozen_contract_conformance | SF-CON-OUTBOX copied between BEGIN/END markers after `{schema}`/`{cmp}` substitution; I16 / 004-30 passed. No `contracts/**` edits. |
| cross_tenant_leakage | 004-P2, 004-13/004-16, I10 executed; T2 cannot select the T1 inbox `event_id`. |
| unresolved_critical_security | Privilege-boundary 004-01..07 and 004-P1..P10 executed (`privilege-boundary.log`). CodeQL temp-file: Kafka `server.properties` written under workspace `test-results/kafka` (mode 0700/0600), not `os.tmpdir()`. |
| lost_committed_applications | I1 rollback leaves no row; I7 simulated broker down/up; K3 real broker stop/start publishes the committed row. |
| component_privilege_boundary | GRANT-only registry; FORCE RLS only on tenant outbox/inbox; publisher catalogue excludes registry. |

## Kafka client replacement (O-LOCK)

`@platformatic/kafka@2.12.1` cannot be admitted: every published version depends on `@platformatic/wasm-utils@^0.2.1`, which `trustPolicy: no-downgrade` rejects (trusted-publishing provenance present on `0.1.0`, removed on `0.2.1`). Policy was **not** turned off. Replacement: **`kafkajs@2.2.4`** (MIT, zero transitive dependencies, no native install script, release age ≫ 7 days). Orchestrator must regenerate `pnpm-lock.yaml`; builders must not commit it.

## Coverage notes

Aggregate **lines 80.69%** on new src meets the ≥80% lines requirement. Process entry points not driven by tests remain at 0% lines: `packages/outbox/src/registry-port.ts`, `services/cmp-038-event-bus/src/registry/sync.ts`, `services/cmp-038-event-bus/src/relay/main.ts`. `packages/outbox/src/transport/kafka.ts` is 92.24% lines.

## Artifacts

- `privilege-boundary.log`, `outbox-atomicity.log`, `broker-outage.log`, `ordering.log`
- `junit/unit.xml`, `junit/integration.xml`, `junit/combined.xml`
- `coverage-summary.json`, `coverage-run.log`
- `scope-check.log`, `gates.log`, `typecheck.log`, `lint.log`, `deps-graph.log`

## Recommended gate status

**IMPLEMENTATION_READY recommended, not VERIFIED, not CERTIFIED.** Independent stitcher / security / evidence verifiers own gates. Do not merge PR 15. Do not start Wave 2.
