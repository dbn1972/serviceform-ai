# SF-M10-B-4 Evidence — Studio/Admin CMP-052 desks on SAMPLE_LAB platform host

**Branch:** `cursor/m10-phase-b-4-studio-tsb-4d00`  
**CERTIFIED:** false | **G6:** false | **self_certified:** false | **TSB seal:** not claimed

## Scope

Phase B slice B-4: mount CMP-033/051/052 on the SAMPLE_LAB platform lab host and wire
Studio + Admin BFFs to forward CMP-004 bearer tokens, eliminating the SF-SYS-002 404 on
`/v1/metadata/documents`, `/v1/publication-requests`, and `/v1/tenant-service-bindings`.

## Changes

### 1. Platform lab bootstrap (`apps/api/scripts/platform-lab-bootstrap.mjs`)
- Added three runtime login roles: `sf_lab_cmp033` → `sf_cmp033_rw`, `sf_lab_cmp051` → `sf_cmp051_rw`,
  `sf_lab_cmp052` → `sf_cmp052_rw` (ADR-0006: NOSUPERUSER, NOBYPASSRLS).
- Emits `DATABASE_URL_CMP033`, `DATABASE_URL_CMP051`, `DATABASE_URL_CMP052` env vars.
- Emits `SF_STUDIO_RATE_LIMIT_MAX`.

### 2. Platform runtime (`apps/api/src/platform/runtime.ts`)
- `PlatformLabEnv`: added `DATABASE_URL_CMP033/051/052`, `SF_STUDIO_RATE_LIMIT_MAX`.
- `PlatformLab`: added optional `m03?: M03PluginMounts`.
- Pools: CMP-033/051/052 pools created when env vars are present (optional, no regression for old envs).
- `Cmp052PublishedBindingPort`: host-layer adapter that reads PUBLISHED `tenant_service_binding`
  rows directly from CMP-052's pool (with `app.tenant_id` RLS context), returning CMP-015-format
  PinGraph by translating CMP-052 PinMap (`form.version_ref` → `form_version_id`, etc.). Falls
  back to `SimulatedPublishedBindingPort` (fixture) when no PUBLISHED row exists in CMP-052.
- M03 load: dynamically imports CMP-033/051/052 modules with `SIMULATED` ports for schema
  registry, metadata, versioning, and approval (INT-013: rejected outside LOCAL/CI).
- Readiness checks added for cmp033/051/052 pools.

### 3. Lab server (`apps/api/src/platform/lab-server.ts`)
- Passes `m03: lab.m03` to `buildApp` when m03 mounts are present.
- Logs `m03Mounted` components at startup.

### 4. Studio BFF (`apps/web-studio/lib/bff.ts` + `handlers.ts`)
- `bff.ts`: added `cmp004Token()`, `simulationAllowed()`, `platform()` helpers.
- `handlers.ts`: rewrote `handleCreateSession` / `handleReadSession` / `handlePlatformProxy`
  to use CMP-004 officer sessions (SIMULATED IdP → opaque bearer token in cookie).
  `handlePlatformProxy` now forwards `Authorization: Bearer <token>`.
- `components/SessionForm.tsx`: changed login from UUID fields to `subject` string (officer sub).

### 5. Admin BFF (`apps/web-admin/lib/bff.ts` + `handlers.ts`)
- Identical pattern to Studio BFF.

### 6. Fixtures
- `fixtures/lab/platform/officers.json`: added studio/admin principals:
  `sample-lab-studio-designer-1` (STUDIO_DESIGNER), `sample-lab-studio-checker-1` (STUDIO_CHECKER),
  `sample-lab-tenant-admin-1` (TENANT_ADMIN_STUDIO).
- `fixtures/lab/platform/opa/sf/tenants/data.json`: added OPA role grants for
  `STUDIO_DESIGNER`, `STUDIO_CHECKER`, `TENANT_ADMIN_STUDIO` with CMP-033/051/052 actions
  (`METADATA_DOCUMENT_*`, `METADATA_BUNDLE_COMPOSE`, `PUBLICATION_REQUEST_*`,
  `TENANT_SERVICE_BINDING_*`).

## Gates not claimed

| Gate | Status | Reason |
|------|--------|--------|
| CERTIFIED | false | Not claimed by builder |
| G6 | false | Not claimed; TSB seal not requested |
| TSB seal | false | Human TSB seal not claimed |
| Self-certified | false | Evidence only; human CI gate required |

## Constraints honoured

- No FROZEN contract mutation (INT-002 path: metadata → maker-checker → immutable TSB publish
  via CMP-052 DB trigger SF_PUBLISHED_IMMUTABLE remains in place).
- No cross-component SQL: `Cmp052PublishedBindingPort` reads only CMP-052's own pool from the
  host composition layer (no component-to-component SQL).
- INT-013: SIMULATED ports refuse to start outside LOCAL/CI.
- INT-011: `assertNoTenantIdentifyingHeaders` still enforced on all proxy calls.
- No PII in logs/fixtures: officers.json uses synthetic names only.
- No human TSB seal claimed.
- No REAL DigiLocker.
