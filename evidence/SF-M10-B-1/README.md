# SF-M10-B-1 — Phase B journey contracts, ADR-0007, OPA citizen-owner policy

| Field | Value |
|---|---|
| Code commit | `61e57dfa861c625dc07c8e61a79f0d1ff158f6ac` (branch `cursor/m10-phase-b-contracts-0b20`, base `main` `4df2a0b`) |
| Run | Local, Cursor cloud VM, 4 Nov 2026. Node 22, PostgreSQL 16 (dedicated cluster), OPA 1.21.1 |
| Builder model | claude-opus-5-5 (this agent). Builder evidence only — independent verification pending |
| Stamp | SAMPLE_LAB · CERTIFIED=false · G6=false · self_certified=false |

## Executed

| Check | Result | Log |
|---|---|---|
| `scripts/opa-test.sh` (check --strict, fmt --fail, test --coverage, build, mutation) | PASS, 68/68 Rego tests (20 new, incl. CMP-004 officer-session actions); `citizen.rego` 100% coverage; mutation check holds | `opa-test.log`, `opa-test-summary.log` |
| `contracts_lock_gate.py` | 44 FROZEN, 0 errors (existing 42 hashes unchanged) | `contracts-lock.log` |
| M10 contract tests + lock-cardinality consumers (CMP-018, CMP-028) | 36/36 | `contract-tests.log` |
| `pnpm test` (root unit/component) | 311 files, 2996 tests passed | `unit-summary.log` |
| CMP-048 integration (real OPA + PostgreSQL) | 18/18 | `cmp048-integration.log` |
| `python3 scripts/gates/run_all.py` | 10/10 | `gates.log` |
| `pnpm format:check`, `pnpm lint`, `@serviceform/api` typecheck | pass | — |

## Not covered here

- Runtime use of the policy by CMP-015 through the host: lands with SF-M10-B-2 (platform wiring).
- ADR-0007 is PROPOSED. Only the owner can accept it for production.
