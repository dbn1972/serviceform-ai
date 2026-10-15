# Residence Certificate Golden Template (IND-SOC-002)

Target shape for M10 Golden Vertical Slice (`SF-M10-001`). Canonical service, form, rules, evidence, workflow, access, SLA, fee, credential and notification definitions for ServiceForm Studio. **No service-specific backend code.** Bundled by `packages/service-packages/ind-soc-002/`.

Owner inputs (Finding M-04) remain `POLICY_INPUT_REQUIRED` until supplied: pilot tenant/State, legal basis, eligibility, evidence, fee, SLA, credential template. Do **not** invent statute. CERTIFIED/G6 remain false until human issues after EVD.

## Artefacts

| File | Role |
|---|---|
| `service.yaml` | Service + offering descriptor |
| `form.schema.json` | JSON Forms application schema (UX4G renderers) |
| `rules.gorules.yaml` | GoRules deterministic rule graph |
| `workflow.yaml` | Temporal workflow model (BPMN import/export only) |
| `evidence-policy.yaml` | Evidence acceptance + verification |
| `fee-policy.yaml` | Fee schedule shell |
| `sla-policy.yaml` | SLA clocks + escalation |
| `credential-template.yaml` | Credential + eSign + DigiLocker |
| `notifications.yaml` | Notification templates |
| `access-policy.yaml` | Channels, auth, consent, maker-checker |
