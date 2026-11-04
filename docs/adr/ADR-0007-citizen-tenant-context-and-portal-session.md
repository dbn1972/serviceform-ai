# ADR-0007: Citizen tenant context on tenant portals, and portal sessions

| Field | Value |
|---|---|
| Status | **PROPOSED** — non-production use authorized under Phase B; production acceptance requires the owner |
| Proposed by | Phase B platform-wiring agent (SF-M10-B-1), 4 November 2026 |
| Date | 4 November 2026 |
| Changes | Host composition and OPA common policy data. No frozen contract hash changes. No new datastore. |

## Context

Phase A lab UAT (finding L-1) showed the citizen portal session was unsigned base64 JSON, so a
forged cookie could read another citizen's applications. Phase B moves the citizen and officer
portals onto the platform path (CMP-004 identity, CMP-015 application/case, OPA, PostgreSQL RLS).
Three seams are undefined on `main` `4df2a0b`:

1. **Citizen tenant context.** Tenant Isolation v1.0 §6/§10: a citizen is a platform-global
   identity, and access to an application is "citizen ownership + tenant/resource checks, not
   citizen tenant membership". CMP-004 therefore resolves a citizen `RequestContext` with
   `tenant_id: null`. CMP-015 rows are TENANT_SCOPED under FORCE RLS and refuse a null tenant
   (`SF-TEN-001`). Nothing derives the tenant for a citizen acting on a tenant's service.
2. **Citizen authorization.** The OPA bundle (`policy/opa/sf`) is role-based only. Citizens have
   no roles, so every citizen action on `ApplicationCase` is `ROLE_NOT_PERMITTED`. There is no
   ownership rule.
3. **Portal session.** No contract says what a portal BFF may keep in a browser cookie.

## Decision

### D-1 Portal-bound tenant context for citizens

A citizen portal deployment is bound to exactly one tenant by server-side **portal placement**
configuration (`contracts/m10/schemas/portal-placement.schema.json`), owned by deployment, not by
the request. For each citizen request the API host builds the CMP-015 `RequestContext` as:

- `actor` = the CMP-004-verified citizen principal (opaque session token → `session_lookup`);
- `tenant_id`, `cell_id` = the portal placement of the host process;
- `roles` = `[]`, `jurisdiction_ids` = `[]`, `auth_assurance` = the session assurance.

The client never supplies a tenant. Any tenant-identifying header is still refused
(`SF-TEN-002`). RLS applies the placement tenant; OPA (D-2) applies ownership. The same citizen
using a second tenant's portal gets that tenant's context and sees none of the first tenant's
rows (RLS), which is the Tenant Isolation §10 requirement.

Cross-tenant "all my applications" (one view over several tenants) is **out of scope** here. It
needs a CITIZEN_PRIVATE citizen↔tenant relationship index (Tenant Isolation §10) and is a
separate ADR.

### D-2 Citizen-owner authorization in OPA (generic, data-driven)

`sf.authz` gains a second permit path beside role grants: `citizen_owner_permits` holds when

- `subject.actor_type == "CITIZEN"` and the subject carries **no roles**;
- the resource type has an entry in `data.sf.common.citizen_owner_grants` whose `actions`
  include the action and whose `assurance` list includes the subject's assurance;
- `resource.owner_id` is present and equals `subject.user_id`.

All existing deny rules still apply first (unknown action, tenant mismatch, tenant data missing,
workflow mismatch, …). A citizen presenting roles is denied with `CITIZEN_ROLES_FORBIDDEN`.
Grants are platform-common policy data (no tenant facts in the bundle), so a tenant cannot widen
what citizens may do. Officer access stays role-based through runtime tenant data.

### D-3 Portal sessions are opaque platform sessions

A portal BFF cookie holds **only** the CMP-004 opaque session token (`HttpOnly`, `SameSite=Lax`,
`Path=/`, `Secure` outside local HTTP). It carries no identity claims. The BFF re-derives identity
on every request from CMP-004 (`GET /v1/identity/me`) and forwards the token as a bearer
credential; it never trusts anything decoded from the cookie. Revocation is CMP-004
`sessions/revoke`. `contracts/m10/schemas/portal-session.schema.json` records this.

### D-4 Fail-closed outside authorized environments

Until the owner accepts this ADR for production, the host refuses to compose the portal-bound
citizen resolver when `SF_ENVIRONMENT=PRODUCTION`. SIMULATED connectors (OTP, DigiLocker,
published-binding port) remain refused in PRODUCTION by their own component guards.

## Consequences

- Citizen IDOR is closed at three layers: CMP-004 session verification, OPA ownership, RLS tenant.
- No frozen contract changes. CMP-015 gains additive operations through CCR-M10-001.
- OPA `policy_revision` moves from `w1-cmp048` to `m10-b1`. CMP-015 records the revision on every
  transition (ADR-0005), so in-flight cases show which policy authorized each step.

## Alternatives considered

- **Tenant from the requested TenantServiceBinding.** Works for create-draft, but reads by
  `application_id` would need a cross-tenant lookup before RLS can apply. Rejected for v1 lab.
- **Citizen tenant membership role.** Contradicts Tenant Isolation §6 ("not citizen tenant
  membership alone"). Rejected.
- **Signed (HMAC) claims cookie.** Fixes forgery but duplicates CMP-004 session state and breaks
  server-side revocation. Rejected in favour of D-3.

## Owner decision needed

Accept D-1…D-4 for production, or direct an alternative. Not CERTIFIED. G6 not affected.
