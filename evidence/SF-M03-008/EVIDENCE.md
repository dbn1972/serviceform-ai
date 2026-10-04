# SF-M03-008 evidence — API host composition for M03 control-plane plugins

**Not CERTIFIED. Not VERIFIED. Not RELEASE CERTIFIED.** Builder self-certification is false.

| Field | Value |
|---|---|
| Task | SF-M03-008 |
| Components | CMP-001, CMP-033, CMP-034, CMP-051, CMP-052, CMP-053, CMP-036 (host only) |
| Integrations | INT-011 (forged tenant-header denial; CROSS_TENANT_LEAKAGE=0 canary). INT-002 not exercised (CMP-050 Studio stays off this Fastify host). |
| Base | `origin/main` `670f604515b74187058f1c054ed1f8e102bba1c3` |
| Branch | `cursor/m03-host-sf-m03-008-9465` |
| Head | `d70371c7d3afe291bbac0648e27d9a0095d25da2` |
| Frozen contracts | unchanged (13/13 MATCH; no CCR) |
| `pnpm-lock.yaml` | not committed |
| `apps/api/package.json` | not modified (envelope write path); plugins load via package specifier then workspace file URL |
| Envelope | `state: READY`, `dispatched: false` (uniqueness gate) |

## Scope delivered

- `apps/api/src/composition/m03.ts`: additive `registerM03Plugins` for CMP-001 (`registerCatalogue`), CMP-033 (`registerMetadata`), CMP-034 (`registerMasterData`), CMP-051 (`registerMakerChecker`), CMP-052 (`registerVersioning`), CMP-053 (`registerLocalization`) under `/v1`.
- `apps/api/src/app.ts`: optional `deps.m03` + `m03Mounted` decorate when supplied. Wave 1/2/M02 composition unchanged. `m03Mounted` is omitted when `deps.m03` is absent so SF-M02-003 host tests still see it as undefined.
- `apps/api/test/composition-m03.test.ts`: host inject tests for SF-TEN-002 / SF-AUTH-001 / SF-AUTH-002 on Wave A + CMP-051/052 routes; Wave 1+2+M02 coexistence; no CMP-050/054 registration; no SQL in composition source.

Not mounted (on purpose):

- CMP-050 Studio portal — Next.js/session library with no Fastify register API (SF-M03-007).
- CMP-054 UX4G — React design package `@serviceform/ui-ux4g` with no Fastify plugin on main.

## Commands (executed)

```bash
pnpm exec prettier --check apps/api/src/composition/m03.ts apps/api/src/app.ts apps/api/test/composition-m03.test.ts
pnpm exec eslint apps/api/src/composition/m03.ts apps/api/src/app.ts apps/api/test/composition-m03.test.ts --max-warnings=0
pnpm --filter @serviceform/api run typecheck
pnpm --filter @serviceform/api run build
pnpm exec vitest run apps/api/test/composition-m03.test.ts apps/api/test/composition-m02.test.ts apps/api/test/composition.test.ts apps/api/test/app.test.ts --coverage.enabled --coverage.include='apps/api/src/**' --coverage.exclude='apps/api/src/server.ts'
python3 scripts/gates/check_scope.py --envelope orchestrator/handovers/SF-M03-008.yaml --base origin/main
python3 scripts/gates/contracts_lock_gate.py
python3 scripts/gates/cg01_path_uniqueness_gate.py
```

## Results (builder-executed)

| Check | Result |
|---|---|
| prettier | PASS |
| eslint `--max-warnings=0` | PASS |
| `@serviceform/api` typecheck | PASS |
| `@serviceform/api` build | PASS (19 external runtime packages, all declared; M03 plugins dynamic) |
| vitest host (30 tests: app + composition + m02 + m03) | PASS |
| INT-011 canary `00000000-0000-4000-8000-000000000099` | absent from deny bodies (`CROSS_TENANT_LEAKAGE=0` on host inject) |
| contracts lock | PASS 13/13 FROZEN |
| check_scope (handover envelope) | PASS |
| cg01_path_uniqueness | PASS (serial pair with SF-M02-003; envelope remains READY) |

Logs: `evidence/SF-M03-008/logs/`. JUnit: `evidence/SF-M03-008/junit/unit.xml`. Coverage summary: `evidence/SF-M03-008/coverage/coverage-summary.json`.

## Residuals (stitch / independent verify)

- Admit `@serviceform/cmp-001-catalogue`, `@serviceform/cmp-033-metadata`, `@serviceform/cmp-034-master-data`, `@serviceform/cmp-051-maker-checker`, `@serviceform/cmp-052-versioning`, `@serviceform/cmp-053-localization` on `apps/api/package.json` + regenerate `pnpm-lock.yaml` (orchestrator stitch). File-URL fallback can then be removed.
- Default process entry (`server.ts`) still does not auto-wire DB/OPA; tests supply doubles.
- Independent SF-M03-INT / SF-M03-SEC / SF-M03-EVD not run by this builder.
- Envelope YAML stays `state: READY` / `dispatched: false` to match `orchestrator/tasks/SF-M03-008.yaml` and `cg01_path_uniqueness_gate`. Recommended develop status below is not an envelope state flip.

## Recommended gate status

Design: complete for host-mount-m03 (001/033/034/051/052/053). Develop: **IMPLEMENTATION_READY** for independent Verify. **Not VERIFIED. Not CERTIFIED.**
