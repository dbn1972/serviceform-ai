# IND-SOC-002 Golden Fixture — Pilot Tenant Overlay + TSB Publish

**Task:** SF-M10-002 · **Branch:** `cursor/m10-002-overlay-91f2`  
**State:** CANDIDATE_COMPLETE · Not CERTIFIED · Not G6 · Not RELEASED  
**Policy input:** `POLICY_INPUT_REQUIRED` (Finding M-04) — no invented statute

These fixtures define the pilot tenant overlay atop the canonical IND-SOC-002 residence
certificate service template, and the corresponding TenantServiceBinding (TSB) publication
record. All owner-supplied fields (pilot tenant identity, legal basis, eligibility rules,
fee anchors, SLA anchors, credential template) carry fail-closed `POLICY_INPUT_REQUIRED`
sentinel values until the statutory owner supplies them.

## Files

| File | Purpose |
|---|---|
| `tenant-overlay.yaml` | Tenant-scoped metadata overlay over the canonical service template |
| `tsb-publish-fixture.json` | TSB publish record (immutable pinned version graph) |
| `sfpackage-manifest-fixture.json` | `.sfpackage` promotion manifest for pilot tenant |
| `maker-checker-record.yaml` | Maker-checker approval record placeholder |
| `POLICY_INPUT_REQUIRED.md` | Owner-input placeholder inventory |

## Absolute prohibitions honoured

- No invented pilot tenant name, State, jurisdiction or statutory authority
- No invented legal basis, eligibility rules, evidence requirements
- No invented fee schedule or SLA anchors
- No invented credential template or DigiLocker document type
- No mutation of published (immutable) versions
- No cross-tenant data
- No PII in fixtures

## Non-claims

CERTIFIED=false · G6=false · self_certified=false · release_certified=false
