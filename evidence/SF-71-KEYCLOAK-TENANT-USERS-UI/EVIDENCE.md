# SF-71 evidence — SAMPLE_LAB Keycloak tenant users Admin UI

| Field | Value |
|---|---|
| Task | SF-71 Keycloak tenant user admin UI via Admin REST API |
| Module | M02 identity admin surface (not a second auth product) |
| Stamp | `CERTIFIED=false` · `G6=false` · `self_certified=false` · SAMPLE_LAB |
| ADR-0007 | **Not claimed accepted** (PROPOSED) · `adr_0007_accepted=false` · `production_idp_claimed=false` |
| DigiLocker / SMS / Payment | Out of scope (no REAL work) |

## What was built

| Piece | Detail |
|---|---|
| Admin UI | `apps/web-admin` `/users` — UX4G list/add/update/assign roles |
| Admin BFF | Allowlist `admin/tenant-users**` → platform `/v1/admin/tenant-users*` |
| Platform | SIMULATED + Keycloak Admin REST adapters (same contract) |
| OPA | `WORKFORCE_USER_*` / `WORKFORCE_ROLE_CATALOGUE_READ` · `WorkforceUser` · TENANT_ADMIN_STUDIO grants |
| Session | Admin SessionForm aligned to CMP-004 subject login (`sample-lab-tenant-admin-1`) |

## Adapter selection

| Mode | When |
|---|---|
| **KEYCLOAK** | `SF_KEYCLOAK_BASE_URL` + admin client id/secret + tenant→realm binding (`SF_KEYCLOAK_TENANT_REALM_MAP` or `SF_KEYCLOAK_REALM`+`SF_KEYCLOAK_TENANT_ID`) |
| **SIMULATED** | Otherwise — clearly labelled; seeded from `officers.json` |

Tenant scope is always the CMP-004 session tenant. Client-supplied tenant ids are ignored. Keycloak users are further filtered by `tenant_id` attribute. No Keycloak Admin Console embed.

## Executed checks

| Check | Result | Log |
|---|---|---|
| `opa test policy/opa` | **133/133 PASS** | `opa-test.log` |
| Vitest (adapters + BFF allowlist + markup) | **13/13 PASS** | `unit-test.log` |
| Vitest rematch (+ Fastify IDOR/OPA routes) | **22/22 PASS** | `unit-test-rematch.log` |
| Prettier check (CI-flagged files) | PASS | `prettier-check.log` |
| ESLint `tenant-users.ts` (no non-null) | PASS | `eslint-tenant-users.log` |
| `@serviceform/api` typecheck | PASS | `typecheck-api.log` |
| `@serviceform/web-admin` typecheck | PASS | `typecheck-web-admin.log` |

## Rematch hardenings (post independent NO-GO on `03a68a0d`)

- Prettier + removed `ctx.tenant_id!`
- BFF allowlist `admin/tenant-users/` (refuses `admin/tenant-users-evil`)
- Fastify route IDOR / OPA-deny / SF-TEN-002 / 503 PDP / no-PII log tests
- Keycloak partial env fail-closed (no silent SIM)
- Keycloak `assignRoles` fails loud on missing realm roles
- Server logger (not `request.log`) for audit events so req.body PII is not attached

## Honesty

- SAMPLE_LAB only. Not production IdP readiness.
- Agents do not self-certify. **CERTIFIED=false. G6=false.**
- Fail-closed OPA; no PII in logs (user_id / counts only).
