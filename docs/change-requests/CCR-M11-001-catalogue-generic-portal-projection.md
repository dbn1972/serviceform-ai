# CCR-M11-001: Catalogue-generic portal application projection (M11 reuse)

| Field | Value |
|---|---|
| Status | **IMPLEMENTED for SAMPLE_LAB** — capability-gap fix required before a second service can reuse the citizen/officer portals without bespoke backend |
| Change class | **Additive / non-breaking for Residence.** Bare apply bodies without `catalogue_id` still default to IND-SOC-002 (CCR-M10-002 compat). Portal views resolve `catalogue_id` from the case pin + placement instead of a hard-coded literal |
| Components | Citizen BFF (`apps/web-citizen`), Officer Workbench copy (`apps/web-officer`), catalogue offer gate (`apps/web-citizen/lib/catalogue.ts`) |
| Related | Constitution §1 §31; `specs/build-plan.yaml` M11; CCR-M10-002 |

## Why

M11 must prove a second certificate (Eng v1.4 example: Income Certificate, IND-SOC-031) can be
onboarded through Studio/metadata. The citizen portal projected every CMP-015 case as
`catalogue_id: 'IND-SOC-002'`, empty-state CTAs deep-linked only to Residence apply, and the
officer home/queue copy named IND-SOC-002. That is named-service UI branching, not a reusable
platform surface.

## Change

1. **`toPortalApplication`** takes optional `catalogue_id` (resolved from the case's
   `tenant_service_binding_id` via portal placement, else from the catalogue form version id).
2. **`isOffered`** additionally refuses templates whose fee/service_time/eligibility/evidence still
   equal `POLICY_INPUT_REQUIRED` — stubs stay gated even if a form version were mistakenly marked
   PUBLISHED without owner policy (Constitution: do not invent statute).
3. **Empty applications CTA** links to `/services` (catalogue), not a hard-coded Residence apply URL.
4. **Officer home/queue** copy refers to submitted applications generically (no IND-SOC-002-only
   queue label). Queue row summary prefers `applicant_name` + ref; residence months shown only when
   present in working data.

## Not changed / blockers

- IND-SOC-031 (and other stubs) remain **not offered**: no PUBLISHED version, policy still
  `POLICY_INPUT_REQUIRED`, placement does not bind them. See
  `fixtures/m11/ind-soc-031/POLICY_INPUT_REQUIRED.md`.
- Certificate detail UI still renders Residence-shaped fields when present; generic field rendering
  for arbitrary Studio schemas is a follow-up capability gap (not required to keep Income gated).
- DigiLocker / OTP / IdP remain **SIMULATED**. **CERTIFIED=false · G6=false · self_certified=false**.

## Delta vs metadata-only rule

This CCR is the smallest reusable platform capability gap: portal projection must not hard-code a
catalogue id. No `services/**` Income Certificate backend was added.
