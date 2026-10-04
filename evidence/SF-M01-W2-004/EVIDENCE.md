# SF-M01-W2-004 evidence — CMP-036 API Gateway + CMP-047 Observability

**Not CERTIFIED.** Builder recommendation: Design complete; Develop ready for independent Verify (INT → SEC → EVD).

| Field | Value |
|---|---|
| Task | SF-M01-W2-004 |
| Components | CMP-036, CMP-047 |
| Integration | INT-011 (edge tenant-header denial; full chain re-verify by SF-M01-W2-SEC) |
| Branch | `cursor/m01-w2-cmp-036-047-aef8` |
| Base | `origin/main` `f397e1319fdf5005b4dfd44e0813d25c5b695ecf` |
| Model / effort | Cursor cloud agent (Composer), effort high |
| Envelope route | opus / claude-opus-5-5 (not the executing runtime) |
| Self-certified | **false** |
| CERTIFIED | **false** |

## Scope delivered (Phase A)

- `services/cmp-036-api-gateway`: edge rate limit, forged tenant/identity header denial, UUID correlation on deny bodies
- `services/cmp-047-observability`: Fastify access-log plugin + bootstrap helper over `@serviceform/observability`
- `packages/observability`: G-10 query-string / fragment stripping in access-log serializers
- `apps/api`: mounts CMP-036 + CMP-047; optional Wave 1 plugin composition via non-literal dynamic import (avoids Fastify module-augmentation clash); `SecurityError` mapped in host error handler

## Explicit non-goals / follow-ups

- CloudFront / WAF / ALB REAL infra (ADR required)
- Phase B: mount CMP-003 / CMP-030 / CMP-032 after those merges (same writer)
- CMP-038 has no HTTP plugin in M01 (process/library only)
- Default process entry does not auto-wire DB/OPA deps; tests supply doubles via `wave1` mounts
- `pnpm-lock.yaml` not committed (orchestrator reconcile)

## Commands and results

| Command | Result |
|---|---|
| Scoped vitest (8 files, 38 tests) + coverage on owned paths | **PASS** — lines 89.52%, functions 91.8%, branches 73.58%, statements 88.33% |
| `pnpm --filter @serviceform/{api,cmp-036-api-gateway,cmp-047-observability,observability} run typecheck` | **PASS** |
| `eslint` on owned paths `--max-warnings=0` | **PASS** |
| `pnpm --filter @serviceform/api run build` | **PASS** — 19 external runtime packages, all declared |
| `check_scope.py --envelope SF-M01-W2-004` | **PASS** |

## Acceptance mapping

| Acceptance (envelope) | Evidence |
|---|---|
| Wave 1 routes reachable via apps/api with frozen error envelopes | `apps/api/test/composition.test.ts` mounts CMP-002 / CMP-031; SF-AUTH-002 / SF-TEN-002 validate |
| Forged client tenant header cannot authorize | CMP-036 edge + host tests → 403 `SF-TEN-002`, no leakage |
| Rate-limit path emits controlled denial without leakage | 429 `SF-RATE-001` contract body; secrets not echoed |
| Logger redacts secrets/PII; telemetry before HTTP patch | observability tests + `server.ts` start order unchanged |
| No business logic ownership stolen | Unknown `/v1` → `SF-SYS-002`; domain deny from component plugins |

## Artifacts

- `vitest.log`, `junit/unit.xml`, `coverage-summary.json`
- `typecheck.log`, `eslint.log`, `build.log`, `scope-check.log`

## Recommended gate status

Design: complete. Develop: **IMPLEMENTATION_READY** for independent integration/security/evidence verifiers. **Not VERIFIED. Not CERTIFIED.**
