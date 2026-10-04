# CMP-011 Evidence & Document Requirement Engine

Determines which evidence a service requires, which alternatives satisfy it, and what is still missing, driven only by a **published, immutable evidence policy version** that an application pins through its `TenantServiceBinding` (CMP-052). Task SF-M04-003 (M04 Wave A). Not CERTIFIED.

## Interfaces

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/evidence-policies` | Create a DRAFT policy (metadata validated against `contracts/evidence-policy.schema.json`) |
| GET / PATCH | `/v1/evidence-policies/{id}` | Read / edit a DRAFT |
| POST | `/v1/evidence-policies/{id}/publish` | Publish an immutable version (maker-checker via `ApprovalPort`) |
| POST | `/v1/evidence-requirements/calculate` | Deterministic checklist for a pinned binding; stores outcome + decision trace |
| GET | `/v1/evidence-resolutions/{id}` | Stored resolution |

Events (`sf.evidence.events.v1`): `EvidencePolicyCreated|Updated|Published`, `EvidenceRequirementsResolved`.

## Rules the engine enforces

- Requirements, alternative sets (OR across sets, AND within a set), exemptions, freshness, assurance, reuse and source preference come **only from policy metadata**. No statutory content in code; no hidden requirement can appear.
- Resolution is deterministic: same pinned policy and inputs give the same checklist and `decision_hash`. Unknown inputs yield `UNDETERMINED`/no exemption (three-valued logic), never a silent "not applicable".
- Pin = `(version_ref, content_hash)`; a hash mismatch fails closed. Publishing v2 never changes what a v1 pin resolves.
- OCR/AI classification is advisory and can never satisfy a requirement.
- No final eligibility decision is made here; the checklist is evidence status only.

## Ports (no sibling source imports)

`BindingPinPort` (CMP-052), `UploadedEvidencePort` (CMP-013), `DocumentClassificationPort` (CMP-014), `ConsentAccessPort` (CMP-030), `ApprovalPort` (CMP-051), `DigiLockerEvidencePort` (INT-013). Port calls are never made inside a DB transaction.

## DigiLocker (INT-013)

Only the SIMULATED adapter exists (`SimulatedDigiLockerEvidenceAdapter`); every response carries a `SimulationMarker`. `REAL`/`SANDBOX` are refused, `SIMULATED` is refused in `PRODUCTION`. CMP-012 is M07. Provider outage degrades to upload options.

## Data

Schema `sf_evidence`, privilege role `sf_cmp011_rw` (NOLOGIN), all tenant tables ENABLE+FORCE RLS, runtime is not table owner. Migrations: `db/migrations/*_cmp-011-*.sql`.

## Non-goals

Host mount (SF-M04-007), CMP-012 real connector, Studio UI, any M05 behaviour, CERTIFIED claim.
