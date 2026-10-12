# SF-M06-005 evidence — API host M06 composition mounts

**Not CERTIFIED. Not RELEASE CERTIFIED. Not G3. Not G6. self_certified false.**

| Field | Value |
|---|---|
| Task | SF-M06-005 (LOCK-7) |
| Branch | `cursor/m06-host-sf-m06-005-91f2` |
| Execution base | `0c61d0c6be7412ed021fc1370fea31382a69a98b` (STITCH-B #126 tip) |
| Mounts | CMP-020, CMP-021, CMP-025, CMP-026 |
| Not remounted | CMP-036 (already on host) |
| SIMULATED | Payment / SMS / EMAIL |
| `pnpm-lock.yaml` | not modified |
| Frozen contracts | 29/29 MATCH; CCR_REQUIRED=false |
| Hard serial | vs SF-M08-007 (no concurrent M08 host open) |

## Scope

- `apps/api/src/composition/m06.ts` — optional `registerM06Plugins`
- `apps/api/src/app.ts` — optional `deps.m06` + `m06Mounted`
- `apps/api/test/composition-m06.test.ts` — mounts, forged tenant denial, SIMULATED boundaries
- Handover + this evidence

## Local executed checks

| Check | Result |
|---|---|
| format / lint / typecheck (api) | PASS |
| host vitest `composition-m06` | **9/9 PASS** |
| regression `composition-m05` + `app` | **27/27 PASS** |
| contracts lock | PASS 29/29 |
| architecture gates | PASS 10/10 |
| check_scope | PASS |
| CROSS_TENANT_LEAKAGE | 0 (canary absent from deny bodies) |

## Certification stance

CERTIFIED=false · G3=false · G6=false · self_certified=false
