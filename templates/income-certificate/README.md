# IND-SOC-031 — Income Certificate (individual)

SAMPLE_LAB M11 config-only authoring shell with **SAMPLE_LAB DUMMY** defaults (synthetic · not statute).

- Dummy inventory: `SAMPLE_LAB_DUMMY.md`
- Shared defaults: `../certificate-packs/sample-lab-dummy/defaults.json`
- Per-id overlay: `owner-config.json`
- Tenant / TSB overlay schema: `../certificate-packs/sample-lab-dummy/tenant-overlay.schema.json`

Merge order: shared defaults → per-id owner-config → CMP-052 tenant overlay.
Fail-closed outside SAMPLE_LAB. Owner must replace before any non-lab use.
Citizen apply still requires a PUBLISHED TSB placement.
CERTIFIED=false · G6=false · self_certified=false.
