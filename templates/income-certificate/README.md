# IND-SOC-031 — Income Certificate (individual)

SAMPLE_LAB M11 config-only authoring shell with **SAMPLE_LAB DUMMY** defaults (synthetic · not statute).

- Dummy inventory: `SAMPLE_LAB_DUMMY.md`
- Shared defaults: `../certificate-packs/sample-lab-dummy/defaults.json`
- Per-id overlay: `owner-config.json`
- Tenant / TSB overlay schema: `../certificate-packs/sample-lab-dummy/tenant-overlay.schema.json`
- Dry-run fixtures: `../../fixtures/m11/ind-soc-031/` (SF-61 path polish)

## Studio → TSB dry-run (SAMPLE_LAB)

1. Template: `/templates/ind-soc-031.income-certificate` (DRAFT / SAMPLE_LAB_STUB)
2. Forms designer: `/forms/designer?template=ind-soc-031.income-certificate`
3. Fee / SLA / Evidence / Credential starters: `ind-soc-031-*` in Studio designers
4. Pin graph dry-run: `fixtures/m11/ind-soc-031/tsb-dry-run-fixture.json`
5. Portal: SAMPLE_LAB placement may lab-offer the **DRAFT** form with DUMMY params

Merge order: shared defaults → per-id owner-config → CMP-052 tenant overlay.
Fail-closed outside SAMPLE_LAB. **SF-33** owner policy required before statutory **PUBLISHED**.
Do not invent Act/eligibility/fee/DigiLocker registrar labels.
CERTIFIED=false · G6=false · self_certified=false.
