# SF-M05-CG-001 evidence — pre-freeze decision package

**Not a freeze. Not CERTIFIED. Not G6. Wave A OFF.**

| Field | Value |
|---|---|
| Task | SF-M05-CG-001 |
| Slice | PRE-FREEZE DECISION PACKAGE |
| Base | `main` `8564055e3d82cf52ddba29086af3cfffddc48f89` |
| `pre_freeze_authorized` | true |
| `freeze_authorized` | false |
| `implementation_authorized` | false |
| `dispatched` | false |
| `wave_a_eligible` | false |
| `contracts_status` | PROPOSED |
| `ccr_required` | **no** |
| Existing frozen 13 | **13/13 MATCH**, hashes changed = 0, `contracts/shared` files changed = 0 |
| ADR-0003 / ADR-0005 | **PROPOSED** only (human-only acceptance) |

## Local executed checks (this tree)

| Check | Result |
|---|---|
| `python3 scripts/gates/contracts_lock_gate.py` | PASS, 13 FROZEN |
| `python3 scripts/gates/run_all.py` | 10/10 gates passed |
| `python3 scripts/gates/validate_specs.py` (via run_all) | PASS |
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS |
| `pnpm contracts:validate` (shared 13 only) | PASS (unchanged plane) |
| `node evidence/SF-M05-CG-001/validate-m05-schemas.mjs` | 6 compile, unique `$id`, no circular M05 `$ref`, valid/invalid examples PASS |
| `python3 evidence/SF-M05-CG-001/contracts-lock-safety.py` | frozen=13, hashes_changed=0, no M05 ids in lock |
| `python3 evidence/SF-M05-CG-001/static-scan.py` | PASS (no named-officer schema fields; BPMN not a runtime; handover freeze false) |

Logs: `logs/schema-validate.log`, `logs/contracts-lock-safety.log`, `logs/static-scan.log`, `logs/gates-summary.json`.

## Proposed contracts (NOT in `orchestrator/contracts-lock.yaml`)

See `hashes.json`. `$id` values under `https://contracts.serviceform.ai/m05/*/v1`.

## ADR recommendations (human)

- **ADR-0003:** recommend ACCEPT as PROPOSED text (request constructs ≠ CMP-015 states).
- **ADR-0005:** recommend ACCEPT as PROPOSED text (runtime authz = current effective published `policy_revision`; statutory pins stay; SF-CON-AUTHZ-DECISION unchanged).

## CCR

**CCR_REQUIRED = no.** Drafts do not require a semantic change to any of the existing 13 frozen contracts, including SF-CON-AUTHZ-DECISION (`policy_revision` already exists on the decision output).

## Explicit non-claims

Did not freeze M05 contracts. Did not append the lockfile. Did not start Wave A. Did not mark ADR-0003 or ADR-0005 ACCEPTED.
