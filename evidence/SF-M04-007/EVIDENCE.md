# SF-M04-007 evidence — API host composition for M04 plugins

**Not CERTIFIED. Not VERIFIED. Not RELEASE CERTIFIED. Not G6.** Builder self-certification is false. **DO NOT MERGE** without separate authorization. M04 G3 not issued. M05 OFF. SF-M04-INT / SF-M04-SEC / SF-M04-EVD not started.

| Field | Value |
|---|---|
| Task | SF-M04-007 (LOCK-7 sole writer) |
| Components | CMP-039, CMP-008, CMP-011, CMP-013, CMP-009, CMP-014; CMP-036 host already mounted |
| Integrations | INT-011 (forged tenant-header denial; CROSS_TENANT_LEAKAGE=0 canary) |
| Draft PR | https://github.com/dbn1972/serviceform-ai/pull/78 |
| Branch | `cursor/m04-host-sf-m04-007-a839` |
| Authoritative base | `d9776b564d5bab6b71a8c1efed3ec06c8d7dc699` (`main`, STITCH-B #77) |
| Frozen contracts | unchanged (13/13 MATCH; no CCR) |
| `pnpm-lock.yaml` | not committed (`pnpm_lock_changed=false`) |
| `apps/api/package.json` | not modified; plugins load via package specifier then workspace file URL |
| Envelope | `state: READY`, `dispatched: false` (uniqueness gate) |

## Scope delivered

- `apps/api/src/composition/m04.ts`: optional `registerM04Plugins` for CMP-039 (`registerAiGateway`), CMP-008 (`registerRules`), CMP-011 (`registerEvidence`), CMP-013 (`registerDocumentUpload`), CMP-009 (`registerForms`), CMP-014 (`registerDocumentIntelligence`) under `/v1`.
- `apps/api/src/app.ts`: optional `deps.m04` + `m04Mounted` decorate when supplied (same optional semantics as `m03Mounted`). Wave 1/2/M02/M03 composition unchanged. CMP-036 `apiGatewayPlugin` remains registered once before composition.
- `apps/api/test/composition-m04.test.ts`: independent mounts, full six, deterministic list, no CMP-036 in `m04Mounted`, M01/M02/M03 lists preserved, `/v1` routes, collision uniqueness, SF-TEN-002 canary, no SQL in composition source, CMP-014 gateway port / no provider SDK.

Expected `m04Mounted`: `CMP-039`, `CMP-008`, `CMP-011`, `CMP-013`, `CMP-009`, `CMP-014`. CMP-036 is **not** in that list.

## Commands (executed)

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm contracts:validate
python3 scripts/gates/contracts_lock_gate.py
pnpm test:cdc
pnpm deps:graph
pnpm build
python3 -m pytest scripts/gates/tests -q
python3 scripts/gates/run_all.py
python3 scripts/gates/check_scope.py --envelope orchestrator/handovers/SF-M04-007.yaml --base origin/main
python3 scripts/gates/cg01_path_uniqueness_gate.py
pnpm db:test
bash scripts/ci/run-m01-envelope-int.sh
pnpm exec vitest run apps/api/test/composition-m04.test.ts apps/api/test/composition-m02.test.ts apps/api/test/composition-m03.test.ts apps/api/test/composition.test.ts apps/api/test/app.test.ts
```

## Results (builder-executed)

| Check | Result |
|---|---|
| frozen-lockfile | PASS |
| format:check | PASS |
| lint | PASS |
| typecheck | PASS |
| test:coverage | PASS 866 tests; stmt 84.04 / branch 72.83 / fn 90.38 / line 87.87 |
| contracts:validate | PASS |
| contracts lock | PASS 13/13 FROZEN |
| test:cdc | PASS 19 |
| deps:graph | PASS 1033 modules |
| build | PASS (`@serviceform/api` 19 external runtime packages, all declared; M04 plugins dynamic) |
| architecture gates | PASS 10/10 |
| check_scope | PASS (allowed writes only) |
| cg01_path_uniqueness | PASS |
| db:test | PASS 3 files / 17 tests |
| M01 envelope | PASS 16/16, fail_count 0 |
| host vitest M02 | PASS 4 |
| host vitest M03 | PASS 5 |
| host vitest M04 | PASS 10 |
| host + app combined | PASS 40 |
| INT-011 canary `00000000-0000-4000-8000-000000000099` | absent from deny bodies (`CROSS_TENANT_LEAKAGE=0` on host inject) |

Logs: `evidence/SF-M04-007/logs/`. JUnit: `evidence/SF-M04-007/junit/unit.xml`. Host coverage summary: `evidence/SF-M04-007/coverage/coverage-summary.json`.

## Security reconfirm

| Flag | Value |
|---|---|
| CROSS_TENANT_LEAKAGE | 0 (host inject canary) |
| frozen_contract_change | false |
| cross_component_SQL | false |
| direct_model_provider_outside_CMP039 | false |
| statutory_AI_decision_path | false |
| SUPERUSER | false (runtime; test harness login is not a production role) |
| BYPASSRLS | false |
| runtime_object_owner | false |
| pnpm_lock_changed | false |
| services_changed | false |
| migrations_changed | false |

CMP-014 host wiring requires `gateway.invoke` (AiGatewayPort). Composition source has no provider SDK imports.

## Residuals

- Admit `@serviceform/cmp-039-ai-gateway`, `@serviceform/cmp-008-rules`, `@serviceform/cmp-011-evidence-requirements`, `@serviceform/cmp-013-document-upload`, `@serviceform/cmp-009-dynamic-forms`, `@serviceform/cmp-014-document-intelligence` on `apps/api/package.json` + regenerate `pnpm-lock.yaml` (orchestrator stitch). File-URL fallback can then be removed.
- Default process entry (`server.ts`) still does not auto-wire DB/OPA; tests supply doubles.
- Independent SF-M04-INT / SF-M04-SEC / SF-M04-EVD not run by this builder.
- Envelope YAML stays `state: READY` / `dispatched: false` to match `orchestrator/tasks/SF-M04-007.yaml` and `cg01_path_uniqueness_gate`.
- GitHub CI/security/developer-platform recorded after this evidence commit (do not amend after green).

## Recommended gate status

Design: complete for host-mount-m04 (039/008/011/013/009/014). Develop: **IMPLEMENTATION_READY** for independent Verify. **Not VERIFIED. Not CERTIFIED.** Do not merge.
