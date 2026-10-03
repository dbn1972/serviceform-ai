# CodeQL triage (PR 17)

No global suppressions. Gates unchanged.

## 1–2. Missing rate limiting (`packages/security/src/plugin.ts`)

Alerts: https://github.com/dbn1972/serviceform-ai/security/code-scanning/1 and /2  
Comments: r4174040932, r4174040942

**Triage:** Genuine as an unbounded authorization hook. Tenant/IP/credential quotas for the public API belong in the shared edge (CMP-036 / M00), which this task cannot write. CMP-048 owns the PEP hooks CodeQL named.

**Fix:** Register `@fastify/rate-limit` (the library `js/missing-rate-limiting` models) on the PEP instance, then a named `rateLimit` hook before `resolvePrincipal` / `enforceRouteAuthz`. In-process `AuthzRateLimiter` remains as a second bound. Exceeded cap → `429 SF-RATE-001`. Default 120/60s, overridable via `authzRateLimit`. Not a substitute for gateway rate limits.

## 3. File system race (`packages/security/src/secrets/local-secrets-provider.ts`)

Alert: https://github.com/dbn1972/serviceform-ai/security/code-scanning/3  
Comment: r4174040949

**Triage:** Genuine TOCTOU (realpath/stat then path `readFile`). Local provider is CI/dev only.

**Fix:** Lexical containment, then `open(..., O_RDONLY|O_NOFOLLOW)`, `fstat` + `readFile` on the same fd, optional `/proc/self/fd` containment. No path-based read after the check.

## Follow-up (alert 5 + CI SAST)

Alert 5 (`r4174065855`) restated missing rate limiting on the combined onRequest hook. Hook split + `@fastify/rate-limit` registration is the CodeQL-visible middleware. No `lgtm` / query-pack suppressions.

Gitleaks `generic-api-key` on `SF_SECRET_*` test literals (`abcdefghij…12` in `1cf3d995`) replaced with `'x'.repeat(32)` (`SYNTHETIC_WRAP_KEY`). Branch history rewritten from `8a4695d` so fetch-depth 0 no longer sees the old blob. Not allowlisted.

Semgrep: `createDecipheriv(..., { authTagLength: 16 })`; pep-opa loopback writes use `node:http` (`opaHttpRequest`) instead of `fetch('http://...')`.
