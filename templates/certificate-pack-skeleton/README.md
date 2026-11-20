# Certificate pack skeleton (SAMPLE_LAB)

Shared authoring skeleton for Certificate-type catalogue stubs that still require
statutory owner policy. Generator: `scripts/catalogue/generate-certificate-packs.mjs`.

**Hard rules**

- Do **not** invent fee, eligibility, evidence, service_time, jurisdiction Act/Rules,
  caste/community enums, or DigiLocker/DLT registrations.
- Packs stay `SAMPLE_LAB_STUB` / DRAFT. Citizen apply remains gated via
  `policyInputsPending` until the owner fills `owner-config` slots and a
  TenantServiceBinding publishes a version.
- `CERTIFIED=false` · `G6=false` · `self_certified=false`.

Hand-crafted exceptions (not generated from this skeleton):

- `templates/residence-certificate/` — IND-SOC-002 PUBLISHED SAMPLE_LAB
- `templates/income-certificate/` — IND-SOC-031 M11 shell (already POLICY_INPUT_REQUIRED)

Owner config schema: `templates/certificate-packs/owner-config.schema.json`.
