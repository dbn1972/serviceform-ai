# SF-M03-004 CMP-051 Maker-Checker — implementation plan

Status: **IMPLEMENTATION_READY** (builder recommendation). **Not VERIFIED. Not CERTIFIED.**

| Field | Value |
|---|---|
| Task | SF-M03-004 |
| Component | CMP-051 |
| Integrations | INT-002 (maker-checker), INT-011, INT-013 fail-closed |
| Privilege role | `sf_cmp051_rw` NOLOGIN (ADR-0006 Option A) |
| Self-certification | **false** |

## Impact

- Domain: generic publication review (maker submit, distinct checker approve/reject). No named-service or statutory branching.
- Data: `sf_maker_checker` only. TENANT_SCOPED FORCE RLS. No cross-schema SQL to CMP-033/052.
- Ports: VersioningPort (hash confirm), MetadataPort (dependency shape), AiValidationPort (advisory; never blocks).
- Events: PublicationRequestCreated/Submitted/Approved/Rejected + audit outbox.
- Host mount / Studio UI deferred (SF-M03-008 / SF-M03-007).
