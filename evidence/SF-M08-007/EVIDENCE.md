# SF-M08-007 evidence — API host M08 composition mounts

**Not CERTIFIED. Not RELEASE CERTIFIED. Not G3. Not G6. self_certified false.**

| Field | Value |
|---|---|
| Task | SF-M08-007 (LOCK-7) |
| Branch | `cursor/m08-007-host-91f2` |
| Execution base | `6cc3eb473abc885e3f7eefc99deb90da37f6db00` (STITCH-B #135 tip) |
| Implementation commit | `f48386f503ed6dd0b9b15831ace1a28e9ebb02a3` |
| Authorization | HUMAN_M08_WAVE_B_THROUGH_EVD_AUTHORIZATION |
| Model | claude-opus-5-5 (route `opus`, effort high) |
| Mounts | CMP-035, CMP-007, CMP-045, CMP-046, CMP-049, CMP-006 |
| Not remounted | CMP-036 (already on host) |
| `pnpm-lock.yaml` | not modified |
| Frozen contracts | 29/29 MATCH; CCR_REQUIRED=false |
| Hard serial | vs SF-M06-005 (M06 host on main; M06 mounts preserved and co-mount tested) |

## Scope

- `apps/api/src/composition/m08.ts` — optional `registerM08Plugins` (non-literal dynamic import)
  - CMP-035 `registerSearchRoutes` under `/v1` prefix
  - CMP-007 `recommendationPlugin` under `/v1` prefix (component builds its own service from ports)
  - CMP-045/046/049/006 transport-neutral `create*Api` + `ROUTE_DESCRIPTORS`
- `apps/api/src/app.ts` — optional `deps.m08` + `m08Mounted` decoration (after M06)
- `apps/api/test/composition-m08.test.ts` — mounts, single CMP-036, `/v1` reachability with
  server-derived context, forged tenant denial, M06 co-existence, no SQL / retention periods
- Handover `orchestrator/handovers/SF-M08-007.yaml` (explicit test path added to
  `allowed_write_paths`: the `apps/api/test/**/m08*` glob does not match `composition-m08.test.ts`)

## Local executed checks

| Check | Result | Log |
|---|---|---|
| host vitest `composition-m08` | **8/8 PASS** | `logs/host-vitest-m08.log` |
| regression `composition-m06` + `composition-m05` + `app` | **36/36 PASS** | `logs/regression-vitest.log` |
| full api host vitest | **71/71 PASS** | `logs/api-host-full-vitest.log`, `junit/api-host.xml` |
| typecheck (api) | PASS | `logs/typecheck.log` |
| eslint / prettier | PASS | `logs/eslint.log`, `logs/format-check.log` |
| check_scope | PASS (4 files) | `logs/check-scope.log` |
| architecture gates | PASS 10/10 | `logs/gates-run-all.log` |
| contracts lock | PASS 29/29 | `logs/contracts-lock.log` |
| CROSS_TENANT_LEAKAGE | 0 (canary absent from every deny body) | test suite |

## Notes / residuals

- M08 service packages are loaded through the file-URL fallback in tests: they are not yet
  declared in `apps/api/package.json` (out of envelope). `pnpm install --frozen-lockfile` was
  run locally to materialise service `node_modules`; lockfile unchanged.
- CMP-007 is exercised with a deny-by-default PDP double (expects `SF-AUTH-002`); no
  recommendation outcome is produced at the host.
- No retention periods are defined at the host.

## Certification stance

CERTIFIED=false · G3=false · G6=false · self_certified=false. Gate status is for human/CI review.
