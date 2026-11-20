# Configurable Certificate authoring packs (SAMPLE_LAB)

Factory-generated Studio authoring packs for Certificate-type catalogue stubs.

| Metric | Count |
| --- | ---: |
| Certificate universe | 158 |
| PUBLISHED (Residence) | 1 — `templates/residence-certificate/` |
| Hand-crafted Income shell | 1 — `templates/income-certificate/` (SAMPLE_LAB DUMMY) |
| Generated configurable packs | 156 — this directory (`<catalogue-id-lower>/`) + Birth |

Every generated pack (and Income) uses **SAMPLE_LAB DUMMY** defaults from
`sample-lab-dummy/defaults.json`, plus a per-id `owner-config.json`. Tenants override via
CMP-052 / `sample-lab-dummy/tenant-overlay.schema.json`. Fail-closed outside SAMPLE_LAB.

`policyInputsPending` is cleared by SAMPLE_LAB DUMMY stamps. Citizen apply still requires a
PUBLISHED version pinned by placement (Residence only today).

- Skeleton: `templates/certificate-pack-skeleton/`
- Shared defaults: `sample-lab-dummy/defaults.json`
- Tenant overlay schema: `sample-lab-dummy/tenant-overlay.schema.json`
- Owner JSON Schema: `owner-config.schema.json`
- Generator: `pnpm exec node scripts/catalogue/generate-certificate-packs.mjs`
- Manifest: `manifest.json` (ids → authoring_path)

**CERTIFIED=false · G6=false · self_certified=false · not_for_production · not_statutory**
