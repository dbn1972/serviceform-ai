# Income Certificate template shell (IND-SOC-031) — M11 SAMPLE_LAB

Config-only authoring shell for the Eng v1.4 second-service reuse proof. Form fields follow the
national registry Recommended Core Fields already in `@serviceform/service-templates`
(`ind-soc-031.income-certificate`). **Every policy artefact is `POLICY_INPUT_REQUIRED`.**

- **Not offered** on the SAMPLE_LAB citizen portal.
- **No invented** fee, eligibility, evidence, SLA, or Odisha/statutory text.
- **No** `services/**` Income backend. Reuses CMP-009 / 015 / 016 / 008 / 033 / 051 / 052.
- DigiLocker remains **SIMULATED**. **CERTIFIED=false · G6=false · self_certified=false**.

Owner blocker inventory: `fixtures/m11/ind-soc-031/POLICY_INPUT_REQUIRED.md`.

## Artefacts

| File | Role |
|---|---|
| `service.yaml` | Service + offering descriptor (policy fields fail-closed) |
| `form.schema.json` | JSON Forms schema aligned to the catalogue stub |
| `rules.gorules.yaml` | Placeholder — no advisory income thresholds invented |
| `workflow.yaml` | Notes WAIT-only reuse of the platform case SM; no named officers |
| `evidence-policy.yaml` | POLICY_INPUT_REQUIRED |
| `fee-policy.yaml` | POLICY_INPUT_REQUIRED |
| `sla-policy.yaml` | POLICY_INPUT_REQUIRED |
| `credential-template.yaml` | POLICY_INPUT_REQUIRED / SAMPLE_LAB markers only when owner supplies |
| `notifications.yaml` | POLICY_INPUT_REQUIRED |
| `access-policy.yaml` | Channel shell; statutory roles POLICY_INPUT_REQUIRED |
