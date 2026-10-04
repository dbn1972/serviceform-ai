# SF-M01-W2-001 implementation plan — CMP-003 Jurisdiction Engine

Status: **IMPLEMENTATION_READY** (builder recommendation). **Not VERIFIED. Not CERTIFIED.**

| Field | Value |
|---|---|
| Task | SF-M01-W2-001 |
| Component | CMP-003 |
| Integration | INT-011 |
| Builder | serviceform-foundation-builder |
| Branch | `cursor/m01-w2-cmp-003-e34d` |
| Base | `origin/main` `f397e13` |
| Schema | `sf_jurisdiction` |
| Privilege role | `sf_cmp003_rw` NOLOGIN (ADR-0006 Option A) |
| Self-certification | **false** |

## Impact

- Domain: versioned jurisdiction types/nodes/relations/bindings; resolve by id/code/address-key; fail closed on cycle/unknown address
- Data: `sf_jurisdiction` only; no cross-schema SQL; opaque binding targets (no FK to CMP-002)
- APIs: Eng GET types/list/children + POST resolve; additive create/publish/relation/binding for operability
- Events: `JurisdictionVersionPublished`, `JurisdictionBoundaryChanged` (+ audit outbox)
- Host mount: deferred to SF-M01-W2-004

## Acceptance (builder-executed)

- Organisation hierarchy not owned/mutated
- No hard-coded geographic level names
- TENANT_SCOPED ENABLE+FORCE RLS; privilege-boundary tests
- Outbox template byte-for-byte after substitution
- Unauthorized / wrong-tenant / forged headers denied with zero leakage
- Circular hierarchy and unknown address fail closed
