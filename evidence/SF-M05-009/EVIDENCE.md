# SF-M05-009 evidence — API host composition for M05 plugins

**Not CERTIFIED. Not VERIFIED. Not RELEASE CERTIFIED. Not G4. Not G6.** Builder self-certification is false. **DO NOT MERGE** without separate `MERGE_AUTHORIZATION`. INT_OFF / SEC_OFF / EVD_OFF / M06 / M08 remain true.

| Field | Value |
|---|---|
| Task | SF-M05-009 (LOCK-7 sole writer) |
| Components | CMP-015, CMP-017, CMP-018, CMP-019, CMP-027, CMP-028, CMP-029 mounted; CMP-016 no host HTTP; CMP-036 host already mounted |
| Integrations | INT-011 (forged tenant-header denial; CROSS_TENANT_LEAKAGE=0 canary); INT-004 referenced by envelope |
| Draft PR | https://github.com/dbn1972/serviceform-ai/pull/102 |
| Branch | `cursor/m05-host-sf-m05-009-3503` |
| Authoritative base | `a10a8db2595604c9e81182eba4e29366ef5e06e7` (`main`, STITCH-B #101) |
| Frozen contracts | unchanged (**19/19 MATCH**; no CCR) |
| `pnpm-lock.yaml` | not committed (`pnpm_lock_changed=false`) |
| `apps/api/package.json` | not modified; plugins load via package specifier then workspace file URL |
| Envelope | uniqueness keys preserved; implementation notes in handover |

## Scope delivered

- `apps/api/src/composition/m05.ts`: optional `registerM05Plugins` for CMP-015 (`registerApplicationCaseRoutes`), CMP-017 (`createTaskHandler` + Fastify adapter), CMP-018 (`createInspectionHandler` + adapter), CMP-019 (`buildDeficiencyApi`.handle + adapter), CMP-027 (`registerGrievanceRoutes`), CMP-028 (`createAppealHandler` + adapter), CMP-029 (`buildSlaApi`.handle + adapter) under `/v1`.
- CMP-016: explicitly **not** mounted; no invented host HTTP.
- CMP-036: **not** remounted from M05 (remains once in `app.ts`).
- `apps/api/src/app.ts`: optional `deps.m05` + `m05Mounted` decorate when supplied. Wave1/2/M02/M03/M04/observability/security/health preserved.
- `apps/api/test/composition-m05.test.ts`: mounts, Wave1–M04 intact, CMP-036 once, CMP-016 absent, transport-neutral adapter semantics, server-derived context / forged `X-Tenant-ID` denial, no cross-component SQL, optional M05 absent, CMP-019/028 residuals carried in source.

Expected `m05Mounted`: `CMP-015`, `CMP-017`, `CMP-018`, `CMP-019`, `CMP-027`, `CMP-028`, `CMP-029`. CMP-016 and CMP-036 are **not** in that list.

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
python3 scripts/gates/run_all.py
python3 scripts/gates/check_scope.py --envelope orchestrator/tasks/SF-M05-009.yaml --base origin/main
python3 scripts/gates/cg01_path_uniqueness_gate.py
pnpm exec vitest run apps/api/test/composition-m05.test.ts apps/api/test/composition-m04.test.ts apps/api/test/composition-m03.test.ts apps/api/test/composition-m02.test.ts apps/api/test/composition.test.ts apps/api/test/app.test.ts
```

Local `pnpm db:test` and `bash scripts/ci/run-m01-envelope-int.sh` require `DATABASE_URL` / PostgreSQL — **not available on this builder VM**; deferred to exact-head GitHub CI (same pattern as other M05 builders without local PG).

## Results (builder-executed)

| Check | Result |
|---|---|
| frozen-lockfile | PASS |
| format:check | PASS |
| lint | PASS |
| typecheck | PASS |
| test:coverage | PASS 1416 tests; stmt 83.99 / branch 74.48 / fn 87.3 / line 87.81 |
| contracts:validate | PASS |
| contracts lock | PASS **19/19 FROZEN MATCH** |
| test:cdc | PASS 19 |
| deps:graph | PASS 1326 modules |
| build | PASS (`@serviceform/api` 19 external runtime packages, all declared; M05 plugins dynamic) |
| architecture gates | PASS 10/10 |
| check_scope | PASS (allowed writes only) |
| cg01_path_uniqueness | PASS |
| db:test | DEFERRED_TO_CI (no local Postgres) |
| M01 envelope | DEFERRED_TO_CI (no local Postgres) |
| host vitest combined | PASS 52 (M05 12 / M04 10 / M03 5 / M02 4 / composition 7 / app 14) |
| INT-011 canary `00000000-0000-4000-8000-000000000099` | absent from deny bodies (`CROSS_TENANT_LEAKAGE=0` on host inject) |

Logs: `evidence/SF-M05-009/logs/`. JUnit: `evidence/SF-M05-009/junit/unit.xml`. Gates: `evidence/SF-M05-009/gates-summary.json`.

## Security reconfirm

| Flag | Value |
|---|---|
| CROSS_TENANT_LEAKAGE | 0 (host inject canary) |
| forged X-Tenant-ID authoritative | false (SF-TEN-002) |
| frozen_contract_change | false |
| cross_component_SQL | false |
| CMP-016 invented host HTTP | false |
| CMP-036 remounted from M05 | false |
| statutory_AI_decision_path | false |
| pnpm_lock_changed | false |
| services_changed | false |
| migrations_changed | false |
| apps/api/package.json changed | false |

## Residuals carried (UNWAIVED)

- **CMP-019** `GOVERNING_UNRESOLVED_UNWAIVED` — see store `docs/m05-006-cmp019.md` and `evidence/SF-M05-009/RESIDUALS.md`
- **CMP-028** `GOVERNING_UNRESOLVED_UNWAIVED` — see store `docs/m05-008-cmp028.md` and `evidence/SF-M05-009/RESIDUALS.md`

## Holds

- Do **not** merge without `MERGE_AUTHORIZATION`
- Do **not** start INT / SEC / EVD / M06 / M08
- Do **not** claim CERTIFIED / G4 / G6
- Do **not** waive CMP-019 or CMP-028
- Do **not** amend/rebase after freeze once candidate head is set

## Recommended gate

**none for certification.** Next: `INDEPENDENT_SF_M05_009_CANDIDATE_REVIEW` / `MERGE_AUTHORIZATION` after exact-head CI / Security / Developer-platform SUCCESS.
