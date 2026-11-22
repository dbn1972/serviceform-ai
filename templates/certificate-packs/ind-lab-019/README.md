# IND-LAB-019 — Factory Registration / Licence

SAMPLE_LAB configurable authoring pack with **SAMPLE_LAB DUMMY** defaults (synthetic · not statute).

- Authoring path: `templates/certificate-packs/ind-lab-019/`
- Dummy inventory: `SAMPLE_LAB_DUMMY.md`
- Shared defaults: `../sample-lab-dummy/defaults.json`
- Per-id overlay: `owner-config.json`
- Tenant / TSB overlay schema: `../sample-lab-dummy/tenant-overlay.schema.json`
- Owner JSON Schema: `../owner-config.schema.json`

## SAMPLE_LAB Studio → TSB pin demo

This pack is a **SAMPLE_LAB pin-demo target**: Studio can author form/workflow/rules and a lab TSB pin graph can reference those versions. **Not** on citizen placement. Inspection pin: `FACTORY_LICENCE_INSPECTION`. Appointment type: `meta:appointment-type:factory-inspection`. See `fixtures/lab/platform/licence-permit-pin-demos.json`.

Merge order: shared defaults → per-id owner-config → CMP-052 tenant overlay.
Fail-closed outside SAMPLE_LAB. Owner must replace before any non-lab use.
Citizen apply still requires a PUBLISHED TSB placement — Licence/Permit remain **not citizen-offerable** until owner statute + placement.
CERTIFIED=false · G6=false · self_certified=false.
