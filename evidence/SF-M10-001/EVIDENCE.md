# SF-M10-001 Evidence — IND-SOC-002 Residence Certificate Studio Template

Builder evidence only. Not CERTIFIED. Not RELEASE CERTIFIED. Not G6.
Builder self-assessment is not verification; independent E2E (SF-M10-003), performance (SF-M10-PERF),
UX4G (SF-M10-004), INT (SF-M10-INT), SEC (SF-M10-SEC), and EVD gate remain required.

| Field | Value |
|---|---|
| Task | SF-M10-001 |
| Module | M10 (CG-03 Golden Residence Certificate) |
| Catalogue ID | IND-SOC-002 |
| Authorization | `HUMAN_CG03_THROUGH_EVD_AUTHORIZATION` = true (Wave A READY on main after #159) |
| Branch | `cursor/m10-001-template-91f2` |
| Base commit | `fd7492b398b2945713957a53b42c4717a7940c3f` (main after #159) |
| Builder agent | serviceform-studio-builder (claude-sonnet-4-6 / sonnet route, medium effort) |
| Model resolved | claude-sonnet-4-6 |
| CCR | false (no frozen contracts changed; 42/42 FROZEN hashes unchanged) |
| Scope check | PASS (4 files checked against SF-M10-001 envelope) |
| Contracts lock | PASS (42/42 FROZEN) |
| CERTIFIED | false |
| G6 | false |
| Policy input required | true (POLICY_INPUT_REQUIRED placeholders throughout) |

## Delivered artefacts

| Path | Purpose |
|---|---|
| `templates/residence-certificate/service.yaml` | Service + offering descriptor with POLICY_INPUT_REQUIRED policy fields |
| `templates/residence-certificate/form.schema.json` | JSON Forms schema; canonical semantic element IDs; UX4G widget hints |
| `templates/residence-certificate/rules.gorules.yaml` | GoRules deterministic rule graph (eligibility, completeness, fee) |
| `templates/residence-certificate/workflow.yaml` | Canonical Temporal workflow model (START → ELIGIBILITY → … → ISSUE → END) |
| `templates/residence-certificate/evidence-policy.yaml` | Technical + business verification states (Constitution §15) |
| `templates/residence-certificate/fee-policy.yaml` | Fee schedule shell (POLICY_INPUT_REQUIRED) |
| `templates/residence-certificate/sla-policy.yaml` | SLA clocks + escalation (Constitution §16; all thresholds POLICY_INPUT_REQUIRED) |
| `templates/residence-certificate/credential-template.yaml` | Credential issuance + DigiLocker + eSign (Constitution §18; SF-CON-CREDENTIAL) |
| `templates/residence-certificate/notifications.yaml` | Notification templates (SF-CON-NOTIFICATION-DISPATCH) |
| `templates/residence-certificate/access-policy.yaml` | Channels, auth, consent, maker-checker (Constitution §36) |
| `packages/service-packages/ind-soc-002/package.yaml` | .sfpackage manifest scaffold (SF-CON-SFPACKAGE-MANIFEST; content_address POLICY_INPUT_REQUIRED at publish) |
| `packages/service-packages/ind-soc-002/README.md` | Package documentation + POLICY_INPUT_REQUIRED list |

## Gate checks executed at base `fd7492b`

| Check | Result |
|---|---|
| `contracts_lock_gate.py` | PASS — 42/42 FROZEN, 0 hashes changed |
| `check_scope.py --envelope SF-M10-001 --files <all template + package + handover>` | PASS — all files within allowed_write_paths |
| `run_all.py` (full suite) | 9/10 gates PASS; migration-lint FAIL on pre-existing M09 files (`cmp-060-risk-integrity.sql`, `cmp-059-migration-workbench.sql`) — not in SF-M10-001 scope (not authored here) |
| No hardcoded jurisdictions gate | PASS |
| contracts-lock gate | PASS |
| validate-specs gate | PASS |

## Architecture compliance

| Requirement | Satisfied |
|---|---|
| No bespoke backend CMP (Constitution §1 §30) | true — metadata only |
| No invented statute, eligibility, fee, SLA, credential template (Finding M-04) | true — all POLICY_INPUT_REQUIRED |
| Published versions immutable (Constitution §8) | Enforced: `immutable_after_publish: true` on all artefacts |
| Temporal workflow runtime; BPMN = import/export only (Constitution §33) | `runtime: TEMPORAL`, `bpmn_role: IMPORT_EXPORT_PROFILE_ONLY` |
| No AI final statutory decision (Constitution §20) | Workflow approval = HUMAN_TASK; AI/LLM excluded from APPROVE node |
| GoRules for deterministic business rules (Constitution §7) | All rule gates use GoRules engine declaration |
| No hard-coded tenant/jurisdiction/officer (Constitution §3) | No named tenant/state/officer anywhere |
| Credential issuance state machine correct (Constitution §18) | GENERATED → SIGNED → ISSUED → CLOSED; DigiLocker failure ≠ reversal |
| Binary evidence in S3, not PostgreSQL (Constitution §5) | `storage_key` + `sha256` refs only |
| Assisted-service applied_by ≠ applied_for (Constitution §36) | Explicit in access-policy.yaml |
| Consent capture required (Constitution §36) | `consent_capture: true` in all channels |
| No PII in logs (Constitution §21) | `pii_excluded_from_logs: true`; Aadhaar last-4 masked |
| .sfpackage no embedded secrets (SF-CON-SFPACKAGE-MANIFEST) | `embedded_secrets_forbidden: true` |
| Maker-checker for TSB publish (Constitution §8 §19) | `migration_maker_checker_required: true` |
| FORCE RLS + OPA authz (Constitution §6 §7) | Declared in access-policy.yaml |
| Frozen contracts unchanged | 42/42 MATCH; 0 CCR |

## POLICY_INPUT_REQUIRED blockers before any PUBLISH

The following statutory owner inputs are required before this template can be published as a live service:

1. Pilot tenant / State / jurisdiction
2. Legal basis (Act, Section, Rule number)
3. Eligibility criteria (minimum residence duration months, age limits, etc.)
4. Accepted evidence document types (authoritative list)
5. Fee schedule per applicant category (may be zero)
6. SLA thresholds in business days per stage + business calendar ref
7. Issuing authority designation and officer roles (no named officers — only role classes)
8. Credential validity period (days) and DigiLocker document type code
9. eSign policy and signing authority role
10. Deficiency cycle limit

## Non-claims

- self_certified: false
- certified: false
- g6: false
- release_certified: false
- builder assertion is NOT verification evidence
- EVD gate recommend only; G6 issued by human after complete verification
