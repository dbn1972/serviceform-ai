# SF-M10-002 evidence — Pilot tenant overlay + TSB publish fixtures (candidate)

**Not CERTIFIED. Not G6. Not released. CANDIDATE_COMPLETE only.**  
**POLICY_INPUT_REQUIRED** (Finding M-04): all owner-supplied statutory fields carry fail-closed
sentinels. No invented statute, eligibility, fee, SLA, credential or pilot tenant identity.

| Field | Value |
|---|---|
| Task | SF-M10-002 |
| Branch | `cursor/m10-002-overlay-91f2` |
| Branch base | `origin/main` `fd7492b398b2945713957a53b42c4717a7940c3f` |
| Head (pre-final) | `ca8be0e172be438b169a174a98a517c3ad2d41f9` |
| Draft PR | **PENDING** — `gh` createPullRequest 403 (integration); open via https://github.com/dbn1972/serviceform-ai/pull/new/cursor/m10-002-overlay-91f2 |
| Builder subagent | `bc-5361629f-6448-5f3c-8c79-67892b67057e` |
| Module | M10 |
| Concurrency group | CG-03 |
| `implementation_authorized` | true (HUMAN_CG03_THROUGH_EVD_AUTHORIZATION) |
| `dispatched` | false (task envelope) |
| `orchestration_task_state` | CANDIDATE_COMPLETE |
| `policy_input_required` | **true** — Finding M-04 blocks finalisation |
| `overlay_status` | `DRAFT_PENDING_POLICY_INPUT` |
| `tsb_publication_state` | `DRAFT_PENDING_POLICY_INPUT` |
| `certified` / `g6` / `self_certified` | false / false / false |
| `release_certified` | false |
| Frozen contracts altered | **false** (read-only; no contracts/** writes) |

## Deliverables produced

| File | Role |
|---|---|
| `fixtures/golden/ind-soc-002/README.md` | Fixture directory overview |
| `fixtures/golden/ind-soc-002/POLICY_INPUT_REQUIRED.md` | Owner-input inventory (12 blocked fields) |
| `fixtures/golden/ind-soc-002/tenant-overlay.yaml` | Tenant overlay metadata (fail-closed placeholders) |
| `fixtures/golden/ind-soc-002/tsb-publish-fixture.json` | TSB publication record (all pin_graph IDs pending) |
| `fixtures/golden/ind-soc-002/sfpackage-manifest-fixture.json` | .sfpackage manifest (synthetic hashes, pending real hashes at publication) |
| `fixtures/golden/ind-soc-002/maker-checker-record.yaml` | Maker-checker record (PENDING_POLICY_INPUT) |
| `evidence/SF-M10-002/EVIDENCE.md` | This file |
| `evidence/SF-M10-002/checks.log` | Executed fixture parse/sentinel/path-boundary checks |
| `orchestrator/handovers/SF-M10-002.yaml` | Handover record |

## Architecture Constitution compliance checks

| Constraint | Status | Note |
|---|---|---|
| No invented statute / eligibility / fee / SLA / credential | PASS | All 12 owner fields carry `POLICY_INPUT_REQUIRED` sentinel |
| No mutation of published versions | PASS | TSB publication_state = DRAFT; no published TSB mutated |
| Immutable TSB once published | PASS | `immutable_once_published: true` in fixture; gate flag false until policy input resolved |
| Maker-checker enforced | PASS | maker-checker-record.yaml present; status PENDING_POLICY_INPUT |
| No cross-tenant data | PASS | Single synthetic tenant context; no cross-tenant references |
| No PII in fixtures | PASS | No citizen data; all user_id fields = POLICY_INPUT_REQUIRED |
| No service-specific backend code | PASS | Metadata-only fixtures; no code written |
| No LLM eligibility decision | PASS | No eligibility claim; all rules = POLICY_INPUT_REQUIRED |
| Frozen contracts unaltered | PASS | `contracts/**` not written; `pnpm-lock.yaml` not written |
| Write paths respected | PASS | Only `fixtures/golden/ind-soc-002/**`, `evidence/SF-M10-002/**`, `orchestrator/handovers/SF-M10-002.yaml` |

## Executed checks

| Check | Result |
|---|---|
| Path boundary audit (no writes outside allowed paths) | PASS — only allowed paths written |
| POLICY_INPUT_REQUIRED sentinel coverage (12 fields inventoried) | PASS — see POLICY_INPUT_REQUIRED.md; overlay sentinel count 49 |
| JSON/YAML parse of all fixtures + handover | PASS — see `checks.log` |
| No invented statute scan (grep for statutory names/amounts/dates) | PASS — no concrete values in policy fields |
| No PII scan (names, IDs, contact data) | PASS — all identity fields = POLICY_INPUT_REQUIRED |
| Frozen contracts unmodified | PASS — no contracts/** files written |
| `invented_statutory_policy_forbidden: true` in all fixture files | PASS |
| `embedded_secrets_forbidden: true` in all fixture files | PASS |
| Non-claims block present in all fixture files | PASS |
| Handover `g6` / `certified` | PASS — both false; state CANDIDATE_COMPLETE |

## Blocking conditions (fail-closed)

The TSB publish gate MUST reject publication while any field listed in
`fixtures/golden/ind-soc-002/POLICY_INPUT_REQUIRED.md` carries the sentinel value.

All 12 policy-input-required fields remain blocked. The following inputs are needed
from the statutory owner before the golden E2E (SF-M10-003) can run end-to-end:

1. Pilot tenant identity (tenant_id, name, state_code)
2. Legal basis (Act, section, gazette reference, effective date)
3. Eligibility rules (GoRules ZEN expression)
4. Evidence requirements (document list)
5. Fee schedule (amount, waivers, gateway)
6. SLA anchors (processing days, clock start event)
7. Credential template (DigiLocker doc type, VC context)
8. Notification templates (SMS DLT PE-ID, template IDs)
9. Issuing authority
10. Local service code
11. Display name (en, hi)
12. Department / jurisdiction

## Dependency chain

```
SF-M09-CG-001 FROZEN_ON_MAIN (#158)
  └─ SF-M10-001 template + Studio package (Wave A, parallel)
  └─ SF-M10-002 overlay + TSB fixtures ← THIS TASK (CANDIDATE_COMPLETE)
       └─ SF-M10-003 Golden E2E + tenant-negative harness (blocked on policy input)
            └─ SF-M10-HOST → INT → SEC → PERF → EVD → human G6
```

## Non-claims

CERTIFIED=false · G6=false · self_certified=false · release_certified=false ·
no invented statute · no LLM eligibility decision · no TSB mutation
