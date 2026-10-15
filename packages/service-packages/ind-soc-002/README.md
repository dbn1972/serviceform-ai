# IND-SOC-002 — Service Package README
# Golden Residence Certificate service package for ServiceForm Studio.

## Purpose

This package bundles all metadata artefacts required to onboard **IND-SOC-002 Residence Certificate** through ServiceForm Studio without bespoke backend code (Architecture Constitution §1 §30).

## Contents

| File | Purpose |
|---|---|
| `package.yaml` | `.sfpackage` manifest + TSB scaffold (SF-CON-SFPACKAGE-MANIFEST) |
| `../../../templates/residence-certificate/service.yaml` | Top-level service + offering descriptor |
| `../../../templates/residence-certificate/form.schema.json` | JSON Forms application schema (UX4G renderers) |
| `../../../templates/residence-certificate/rules.gorules.yaml` | GoRules deterministic rule graph |
| `../../../templates/residence-certificate/workflow.yaml` | Canonical Temporal workflow model (BPMN = import/export only) |
| `../../../templates/residence-certificate/evidence-policy.yaml` | Evidence acceptance + verification policy |
| `../../../templates/residence-certificate/fee-policy.yaml` | Fee schedule |
| `../../../templates/residence-certificate/sla-policy.yaml` | SLA clocks + escalation |
| `../../../templates/residence-certificate/credential-template.yaml` | Credential output + eSign + DigiLocker |
| `../../../templates/residence-certificate/notifications.yaml` | Notification templates |
| `../../../templates/residence-certificate/access-policy.yaml` | Channels, auth, consent, maker-checker |

## POLICY_INPUT_REQUIRED

The following fields **must be supplied by the statutory owner** before any PUBLISH action:

- Pilot tenant/State name
- Legal basis (Act/Section/Rule)
- Eligibility criteria (minimum residence duration, age, etc.)
- Accepted evidence document types
- Fee schedule (may be zero)
- SLA thresholds (business days per stage) and business calendar
- Issuing authority designation / officer roles
- Credential validity period and DigiLocker doc-type code
- eSign policy and signing authority role

**Do NOT invent any of the above.** (Finding M-04; Architecture Constitution §3 §20 §29)

## Consumed FROZEN contracts

All frozen contracts are consumed read-only. No new backend CMP. No new contract schemas required for this template package. Existing lock rows immutable (SF-M09-CG-001 v2.7).

## How to publish via Studio

1. Load this package in ServiceForm Studio.
2. Confirm all POLICY_INPUT_REQUIRED fields are filled by the statutory owner.
3. Run Studio metadata validation.
4. Request maker-checker approval for TenantServiceBinding.
5. Publish — Studio computes content_address and calls signing service.
6. Generated `.sfpackage` is immutable from that point (Constitution §8 §34).
