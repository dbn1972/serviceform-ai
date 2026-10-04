# SF-M02-003 evidence — API host composition for CMP-004 and CMP-005

**Not CERTIFIED. Not VERIFIED. Not RELEASE CERTIFIED.** Builder self-certification is false.

| Field | Value |
|---|---|
| Task | SF-M02-003 |
| Components | CMP-004, CMP-005, CMP-036 (host only) |
| Integrations | INT-011 (forged tenant-header denial; CROSS_TENANT_LEAKAGE=0 canary). INT-001 not exercised (SIMULATED adapters remain inside CMP-004/005). |
| Base | `origin/main` `d66a94c3fba19d00f2c881bd257e90beb922322f` |
| Branch | `cursor/m02-host-sf-m02-003-b16e` |
| Head | `e3f15a1bcd0650c118dfae9e6ca6ca953bd523db` |
| Frozen contracts | unchanged (13/13 MATCH; no CCR) |
| `pnpm-lock.yaml` | not committed |
| `apps/api/package.json` | not modified (envelope write path); plugins load via package specifier then workspace file URL |
| SF-M03-008 | not started; no M03 mounts |

## Scope delivered

- `apps/api/src/composition/m02.ts`: additive `registerM02Plugins` for CMP-004 (`registerIdentityAccess`) and CMP-005 (`registerCitizenProfile`) under `/v1`.
- `apps/api/src/app.ts`: optional `deps.m02` + `m02Mounted` decorate. Wave 1/2 composition unchanged.
- `apps/api/test/composition-m02.test.ts`: host inject tests for SF-TEN-002 / SF-AUTH-001 / SF-AUTH-002; Wave 1+2 coexistence; no M03 registration; no SQL in composition source.

## Commands (executed)

```bash
pnpm exec prettier --check apps/api/src/composition/m02.ts apps/api/src/app.ts apps/api/test/composition-m02.test.ts orchestrator/handovers/SF-M02-003.yaml
pnpm exec eslint apps/api/src/composition/m02.ts apps/api/src/app.ts apps/api/test/composition-m02.test.ts --max-warnings=0
pnpm --filter @serviceform/api run typecheck
pnpm --filter @serviceform/api run build
pnpm exec vitest run apps/api/test/composition-m02.test.ts apps/api/test/composition.test.ts apps/api/test/app.test.ts --coverage
python3 scripts/gates/check_scope.py --envelope orchestrator/handovers/SF-M02-003.yaml --base origin/main --files …
python3 scripts/gates/contracts_lock_gate.py
```

## Results (builder-executed)

| Check | Result |
|---|---|
| prettier | PASS |
| eslint `--max-warnings=0` | PASS |
| `@serviceform/api` typecheck | PASS |
| `@serviceform/api` build | PASS (19 external runtime packages, all declared; M02 plugins dynamic) |
| vitest host (25 tests: app + composition + m02) | PASS |
| INT-011 canary `00000000-0000-4000-8000-000000000099` | absent from deny bodies (`CROSS_TENANT_LEAKAGE=0` on host inject) |
| contracts lock | PASS 13/13 FROZEN |
| check_scope (handover envelope) | PASS |

Logs: `evidence/SF-M02-003/logs/`. JUnit: `evidence/SF-M02-003/junit/unit.xml`. Coverage summary: `evidence/SF-M02-003/coverage/coverage-summary.json`.

## Residuals (stitch / independent verify)

- Admit `@serviceform/cmp-004-identity-access` and `@serviceform/cmp-005-citizen-profile` on `apps/api/package.json` + regenerate `pnpm-lock.yaml` (orchestrator stitch). File-URL fallback can then be removed.
- Default process entry (`server.ts`) still does not auto-wire DB/OPA; tests supply doubles.
- Independent SF-M02-INT / SF-M02-SEC / SF-M02-EVD not run by this builder.
- SF-M03-008 remains serialized after this single-writer window.
- Envelope YAML stays `state: READY` / `dispatched: false` to match `orchestrator/tasks/SF-M02-003.yaml` and `cg01_path_uniqueness_gate` (promote copy). Recommended develop status below is not an envelope state flip.

## Recommended gate status

Design: complete for host-mount-m02. Develop: **IMPLEMENTATION_READY** for independent Verify. **Not VERIFIED. Not CERTIFIED.**
