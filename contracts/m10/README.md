# M10 contracts — Phase B portal → platform journey (FROZEN on merge)

Authorized by Debabrata Nayak (Phase B). Appends two NEW rows to `orchestrator/contracts-lock.yaml`
(lock v2.8). The existing 42 frozen contracts are unchanged.

| ID | File | Owner | Subject |
|---|---|---|---|
| SF-CON-PORTAL-PLACEMENT | `schemas/portal-placement.schema.json` | Host (CMP-036 composition) | Server-side portal → tenant/cell binding; citizen tenant context source (ADR-0007 D-1) |
| SF-CON-PORTAL-SESSION | `schemas/portal-session.schema.json` | Portal BFFs (CMP-050 surfaces) + CMP-004 | Portal cookie holds only the CMP-004 opaque token; identity re-derived per request (ADR-0007 D-3) |

Related, not in this directory:

- `docs/adr/ADR-0007-citizen-tenant-context-and-portal-session.md` (PROPOSED).
- `docs/change-requests/CCR-M10-001-cmp015-journey-reads-and-working-data.md` — additive CMP-015
  operations (list, working data). Non-breaking; lands with the CMP-015 implementation.
- `policy/opa/sf/authz/citizen.rego` — citizen-owner permit path (ADR-0007 D-2).

## Invariants encoded

- A placement never accepts a client-supplied tenant (`client_tenant_input_accepted: false`).
- Citizen tenant context is derived from the placement only (`PORTAL_PLACEMENT`).
- PREPROD/PRODUCTION placements are invalid until ADR-0007 is accepted for production.
- A portal cookie carries no claims, is `HttpOnly`, and is never decoded for identity.

Not CERTIFIED. G6 not affected. SAMPLE_LAB placements are labelled `environment_label: SAMPLE_LAB`.
