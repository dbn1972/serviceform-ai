# SF-M03-007 CMP-050 Studio + admin portal — implementation plan

## Scope

- `services/cmp-050-studio-portal`: portal kernel (no SQL, no Fastify host)
- `apps/web-studio`, `apps/web-admin`: UX4G 3.0 product surfaces

## Acceptance (builder evidence; not CERTIFIED)

1. INT-002 client sequences metadata validate → maker-checker UX → TenantServiceBinding publish call
2. Maker cannot approve own request in UX guards (engine remains CMP-051)
3. INT-011: tenant identifying headers refused; TenantWorkspace CROSS_TENANT_LEAKAGE=0
4. UX4G-only UI; no second design system; JSON Forms via UX4G renderers
5. Host API / `apps/api` untouched; lockfile and frozen contracts untouched
6. SIMULATED workforce session forbidden in PRODUCTION

## Stop conditions honored

- No frozen shared contract edits / no `pnpm-lock.yaml`
- No writes outside allowed paths
- `self_certified: false`, `not_certified: true`
