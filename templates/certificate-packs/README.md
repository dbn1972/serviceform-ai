# Configurable Certificate authoring packs (SAMPLE_LAB)

Factory-generated Studio authoring packs for Certificate-type catalogue stubs.

| Metric | Count |
| --- | ---: |
| Certificate universe | 158 |
| PUBLISHED (Residence) | 1 — `templates/residence-certificate/` |
| Hand-crafted Income shell | 1 — `templates/income-certificate/` |
| Generated configurable packs | 156 — this directory (`<catalogue-id-lower>/`) |

Every generated pack keeps fee / eligibility / evidence / service_time / jurisdiction as
`POLICY_INPUT_REQUIRED`. Citizen apply stays gated via `policyInputsPending`.

- Skeleton: `templates/certificate-pack-skeleton/`
- Owner JSON Schema: `owner-config.schema.json`
- Generator: `pnpm exec node scripts/catalogue/generate-certificate-packs.mjs`
- Manifest: `manifest.json` (ids → authoring_path)

**CERTIFIED=false · G6=false · self_certified=false**
