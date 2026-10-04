# SF-M03-004 CMP-052 Versioning — implementation plan

Status: **IMPLEMENTATION_READY** (builder recommendation). **Not VERIFIED. Not CERTIFIED.**

| Field | Value |
|---|---|
| Task | SF-M03-004 |
| Component | CMP-052 |
| Integrations | INT-002 (publication), INT-011, INT-013 fail-closed |
| Privilege role | `sf_cmp052_rw` NOLOGIN (ADR-0006 Option A) |
| Self-certification | **false** |

## Impact

- Domain: TenantServiceBinding pins + content-addressed artifact versions. Authorization policy version is pinned at publish (Constitution #9); ADR-0005 is not accepted so this slice does not float policy.
- Data: `sf_versioning` only. TENANT_SCOPED FORCE RLS. Insert-only published artifact rows. No cross-schema SQL.
- Ports: ApprovalPort (checker must have approved; fail closed if port throws).
- Events: TenantServiceBindingCreated/Updated/Published, ArtifactVersionPublished + audit outbox.
- Host mount / Studio UI deferred.

## Acceptance (builder evidence; not CERTIFIED)

1. Checker approval required before publish
2. Published artifact hash stable
3. Reject mutation of published version
4. CROSS_TENANT_LEAKAGE=0
