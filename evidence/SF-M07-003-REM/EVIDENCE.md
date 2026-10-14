# SF-M07-003-REM — M07-SEC-F05 remediation evidence

CERTIFIED=false · G3=false · G6=false · self_certified=false. Builder evidence only; re-verification by the independent SEC role is required.

| Field | Value |
| --- | --- |
| Finding | M07-SEC-F05 (HIGH): QR opaque bearer token in `GET /v1/qr/verify/:opaque_token` written to host `incoming request` and `request completed` log lines |
| Branch | `cursor/m07-003-rem-91f2` |
| Base | `origin/main` @ `dfa96a0e8b61754d2ed6323bae8455caf5a285aa` |
| Fix commit | `5aa4fe589b7605d7f6bd104d36bf643b961a6460` |
| Builder | serviceform-credential-builder, model route `opus`, release `claude-opus-5-5` |
| Authorization | HUMAN_M07_THROUGH_EVD_AUTHORIZATION = true |

## Fix

- **CMP-023** (`services/cmp-023-qr-verification/src/api/handler.ts`): `RouteDescriptor.logRedactedParams` (optional, additive) declares path params that carry a bearer secret. Only the verify route sets it (`['opaque_token']`). The HTTP route, OpenAPI contract and frozen `SF-CON-VERIFICATION-TOKEN` are unchanged.
- **Host** (`apps/api/src/composition/m07.ts`): for descriptors that declare `logRedactedParams`, the M07 mount sets a route-scoped Fastify `logSerializers.req`. It runs the existing CMP-047 `sanitizeRequestForLog` (path only, no query/fragment) and then swaps the declared segments for their `:param` template. Fastify 5.12.5 builds the per-request child logger with route serializers before it logs `incoming request`, and CMP-047's `onResponse` `request completed` line logs `req` through that same child, so one serializer covers both lines. Other routes and the shared sanitiser in `packages/observability` / `services/cmp-047-observability` are untouched.
- Logged URL for verify is now `/v1/qr/verify/:opaque_token`.

## Tests (executed)

| Suite | Result | Artefact |
| --- | --- | --- |
| CMP-023 unit + contract (incl. new F05 regression) | 66/66 pass | `junit/unit.xml`, `logs/cmp-023-unit-contract.log` |
| apps/api host (all composition suites) | 81/81 pass | `junit/apps-api.xml`, `logs/apps-api-tests.log` |
| Negative control: tests with fix reverted | 3 fail as expected (token present in logs) | `logs/negative-control-without-fix.log` |
| prettier / eslint `--max-warnings=0` / tsc (apps/api, cmp-023) | pass | `logs/static-checks.log` |

New regression tests:
- `test/contract/host-log-redaction.test.ts`: drives the real CMP-023 service through `buildApp` with the production `createLogger`. It checks that (1) a valid verify logs only the template in both lines, with no token and no query, (2) unknown, malformed and too-short tokens are redacted the same way, and (3) non-bearer routes such as `GET /v1/qr/tokens/:token_id` keep their path, so redaction is route-scoped.
- `test/contract/contracts.test.ts`: only `GET /v1/qr/verify/:opaque_token` declares `logRedactedParams = ['opaque_token']`.

Not run: CMP-023 Postgres integration suite. The domain, repo and SQL are unchanged.

## Residuals / follow-ups (not waived)

- The SEC suite assertion `expect(text).toContain(opaque)` in `tests/security/m07/pii-logging.test.ts` (on the SEC branch) documents the finding. After this change it will fail, and the SEC role should flip it to `not.toContain`. That file is outside this envelope.
- Defence-in-depth is per-route. A future component with a bearer path param must declare `logRedactedParams`, and a host mount must honour it. Only the M07 composition honours it today. A platform-wide CMP-047 route-template logging policy would be a CMP-047/host decision and was not invented here.
- Upstream proxies, CDN or ALB access logs outside the Fastify host are not covered by this change. Infra log configuration is out of scope.
