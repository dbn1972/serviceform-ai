# Evidence — SF-M10-B-4: Studio/Admin CMP-052 Desks on SAMPLE_LAB Platform Host

**CERTIFIED=false | G6=false | self_certified=false | TSB seal NOT claimed**
**Stamp:** SAMPLE_LAB · LOCAL/CI only · SIMULATED connectors

---

## Changes

### Root gap fixed
Lab host returned HTTP 404 `SF-SYS-002` for Studio/Admin platform routes because M03 was not
mounted. Studio/Admin BFF did not forward `Authorization: Bearer` so context resolution via
`placementContextResolver` could not resolve a `RequestContext`.

### Files changed

| File | Change |
|---|---|
| `apps/api/scripts/platform-lab-bootstrap.mjs` | Added `sf_lab_cmp033/051/052` roles + CMP-052 TSB seed |
| `apps/api/src/platform/runtime.ts` | M03 env vars; CMP-033/051/052 pools/mounts; `Cmp052PublishedBindingAdapter`; `Cmp052PreferringBindingPort` replaces `SimulatedPublishedBindingPort` |
| `apps/api/src/platform/lab-server.ts` | Pass `m03` to `buildApp`; include in mounted log |
| `apps/api/src/platform/simulators.ts` | `POST /v1/simulated/studio-auth` endpoint (mints CMP-004 session for studio/admin actor) |
| `apps/web-studio/lib/bff.ts` | CMP-004 opaque token session; `bearerToken()` extractor; `simulationAllowed()` |
| `apps/web-studio/lib/handlers.ts` | `handleCreateSession` calls studio-auth; `handlePlatformProxy` forwards `Authorization: Bearer` |
| `apps/web-studio/app/api/session/route.ts` | `GET` changed to `Promise<Response>` |
| `apps/web-admin/lib/bff.ts` | Same as studio |
| `apps/web-admin/lib/handlers.ts` | Same as studio |
| `apps/web-admin/app/api/session/route.ts` | `GET` changed to `Promise<Response>` |
| `fixtures/lab/platform/officers.json` | Added `STUDIO_DESIGNER`, `STUDIO_CHECKER`, `TENANT_ADMIN` SIMULATED officers |
| `fixtures/lab/platform/opa/sf/tenants/data.json` | Added OPA role grants for `STUDIO_DESIGNER`, `STUDIO_CHECKER`, `TENANT_ADMIN` |
| `apps/web-studio/test/bff.test.ts` | Updated for new CMP-004 session pattern |
| `apps/web-admin/test/bff.test.ts` | Updated for new CMP-004 session pattern |

### Architecture alignment
- **ADR-0007 D-1**: identity comes from CMP-004 bearer token; studio/admin BFFs now forward
  `Authorization: Bearer` on every proxy call. Local session encoding removed.
- **INT-013**: SIMULATED connectors refused outside LOCAL/CI (`assertSimulatorEnvironment`).
- **INT-011**: tenant-identifying headers still blocked in BFF proxy and session creation.
- **CMP-052 preference**: `Cmp052PreferringBindingPort` tries CMP-052 published bindings first,
  falls back to `SimulatedPublishedBindingPort` seeded from `published-bindings.json`.
- **No FROZEN contract mutation**: `SF-CON-PORTAL-SESSION` unchanged (studio-auth uses the
  existing officer session infrastructure; no new portal-session surface added).

### Studio/Admin session lifecycle (after B-4)
1. Browser `POST /api/session` with `{ tenant_id, actor_id, roles }` (SessionForm.tsx unchanged)
2. BFF validates body; calls `POST /v1/simulated/studio-auth` on the platform host
3. Host simulator mints CMP-004 assertion → exchanges with `/v1/identity/officer/sessions`
4. BFF sets cookie with the opaque CMP-004 session token only (no session claims in cookie)
5. Browser `GET/POST /api/platform/<path>` → BFF extracts token → forwards `Authorization: Bearer`
6. Host's `placementContextResolver` resolves `RequestContext` from CMP-004

### Not claimed
- G6 seal: `tsb_immutability_sealed=false`
- Human maker-checker TSB seal
- REAL DigiLocker
- CERTIFIED gate: not self-certifiable by builder agent

---

## Test runs (LOCAL/CI only)

| Test suite | Status | Note |
|---|---|---|
| `apps/web-studio` BFF unit tests | PENDING CI run | Security invariants pass without live API |
| `apps/web-admin` BFF unit tests | PENDING CI run | Same |
| M03 composition (existing) | PENDING CI run | m03 mounts already tested in composition suite |

Run with: `pnpm --filter @serviceform/web-studio test` and `pnpm --filter @serviceform/web-admin test`

---

## OPA actions added (lab fixture only)

For `STUDIO_DESIGNER`: `METADATA_DOCUMENT_CREATE/READ/UPDATE/VALIDATE/PUBLISH`,
`METADATA_BUNDLE_COMPOSE`, `PUBLICATION_REQUEST_CREATE/READ/SUBMIT`

For `STUDIO_CHECKER`: `METADATA_DOCUMENT_READ`, `PUBLICATION_REQUEST_READ/APPROVE/REJECT`

For `TENANT_ADMIN`: `METADATA_DOCUMENT_READ`, `PUBLICATION_REQUEST_READ`,
`TENANT_SERVICE_BINDING_CREATE/READ/UPDATE/PUBLISH`

---

*Builder agent: bc-c8ee6452-1e6e-5756-b55f-115403a2467a | Branch: cursor/m10-phase-b-4-studio-tsb-467a*
