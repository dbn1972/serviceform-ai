# IND-BTP-010 — Stamp Vendor Licence Renewal

SAMPLE_LAB configurable authoring pack with **SAMPLE_LAB DUMMY** defaults (synthetic · not statute).

- Authoring path: `templates/certificate-packs/ind-btp-010/`
- Dummy inventory: `SAMPLE_LAB_DUMMY.md`
- Shared defaults: `../sample-lab-dummy/defaults.json`
- Per-id overlay: `owner-config.json`
- Tenant / TSB overlay schema: `../sample-lab-dummy/tenant-overlay.schema.json`
- Owner JSON Schema: `../owner-config.schema.json`

Merge order: shared defaults → per-id owner-config → CMP-052 tenant overlay.
Fail-closed outside SAMPLE_LAB. Owner must replace before any non-lab use.
Citizen apply still requires a PUBLISHED TSB placement (Residence only today).
CERTIFIED=false · G6=false · self_certified=false.
