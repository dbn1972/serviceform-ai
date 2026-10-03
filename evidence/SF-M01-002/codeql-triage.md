# CodeQL triage (PR 17)

No global suppressions. Gates unchanged.

## 1–2. Missing rate limiting (`packages/security/src/plugin.ts`)

Alerts: https://github.com/dbn1972/serviceform-ai/security/code-scanning/1 and /2  
Comments: r4174040932, r4174040942

**Triage:** Genuine as an unbounded authorization hook. Tenant/IP/credential quotas for the public API belong in the shared edge (CMP-036 / M00), which this task cannot write. CMP-048 owns the PEP hooks CodeQL named.

**Fix:** In-process sliding-window limiter (`AuthzRateLimiter` + `rateLimitAuthorization`) on both `onRequest` and `preHandler`. Exceeded cap → `429 SF-RATE-001`. Default 120/60s, overridable via `authzRateLimit`. Not a substitute for gateway rate limits.

## 3. File system race (`packages/security/src/secrets/local-secrets-provider.ts`)

Alert: https://github.com/dbn1972/serviceform-ai/security/code-scanning/3  
Comment: r4174040949

**Triage:** Genuine TOCTOU (realpath/stat then path `readFile`). Local provider is CI/dev only.

**Fix:** Lexical containment, then `open(..., O_RDONLY|O_NOFOLLOW)`, `fstat` + `readFile` on the same fd, optional `/proc/self/fd` containment. No path-based read after the check.
