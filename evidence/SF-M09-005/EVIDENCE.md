# SF-M09-005 evidence — CMP-060 Risk / Integrity

Builder candidate evidence only. **Not CERTIFIED / not G3 / not G4 / not G6 / not self-certified.**
No gate is issued here; independent INT / SEC / EVD review and a human or CI gate are still required.
Recommended gate status: none (builder candidate).

- Authorization: `HUMAN_CG03_THROUGH_EVD_AUTHORIZATION` (Wave A READY after SF-M09-CG-001 FROZEN_ON_MAIN).
- Execution base: `fd7492b398b2945713957a53b42c4717a7940c3f` (`origin/main` / Wave A READY tip).
- Branch: `cursor/m09-005-risk-91f2`. Draft PR opened by the builder; not merged.
- Agent / model: Cursor Cloud Agent, route `opus` (per `MODEL-ROUTING-QUALITY.md`; self-assessment is not evidence).

## Governance (non-authoritative)
- `authoritative_decision_by_this_component` is always `false` — TypeScript response shape, outbox
  payload, domain gate, and PostgreSQL `CHECK` / transition trigger on `sf_risk.risk_assessment`.
- `invented_statutory_policy_forbidden` is always `true` (service + DB CHECK).
- Signal codes that encode statutory outcomes (`APPROVE`, `REJECT`, `ELIGIBLE`, …) are refused with
  `422 SF-AI-001` before any DB write.
- Raw risk score is stored for explainability; HIGH/CRITICAL tiers only request authorized human
  review (INT-018). This component never approves, rejects, or determines eligibility.
- Schema `sf_risk`, privilege role `sf_cmp060_rw` (NOLOGIN, NOSUPERUSER, NOBYPASSRLS). FORCE RLS on
  tenant-scoped tables. Consumes FROZEN `SF-CON-RISK-ASSESSMENT` only.

## Executed checks (logs in `logs/`)
| Check | Result | Log |
|---|---|---|
| tsc `--noEmit` (package) | exit 0 | `typecheck.log` |
| ESLint `--max-warnings=0` (package) | exit 0 | `eslint.log` |
| Prettier `--check` (package) | exit 0 | `prettier.log` |
| Unit + contract + security (vitest 3.2.4) | 54/54 pass (30 unit, 8 contract, 16 security) | `unit-contract-security.log`, `junit/*.xml` |
| Repo gates `scripts/gates/run_all.py` | 10/10 PASS | `gates.log` |
| Write scope `check_scope.py --envelope orchestrator/handovers/SF-M09-005.yaml` | PASS, 34 files | `scope.log`, `write-scope-diff.txt` |

Commands (from `services/cmp-060-risk-integrity`):
`pnpm typecheck`; `pnpm test:unit`; `pnpm test:contract`; `pnpm test:security`.
Podless builder VM: no PostgreSQL integration suite in this lane (deferred to SF-M09-INT).
CI-only checks (CodeQL, Semgrep packs, gitleaks, checkov, coverage thresholds, dependency-cruiser)
were not run on the builder VM.

## Requirement → test traceability
- `authoritative_decision_by_this_component === false`: `risk-assessment-contract.test.ts`,
  `service-governance.test.ts`, migration CHECK asserted in `governance-boundary.test.ts`.
- Advisory-only signals / Constitution rule 40: `risk-classifier.test.ts`,
  `governance-boundary.test.ts`, `service-governance.test.ts` (REJECT blocked before DB).
- INT-018 HIGH/CRITICAL → review requested: `service-governance.test.ts`,
  `risk-classifier.test.ts` (`requiresHumanReview`).
- INT-011 tenant isolation: `context.test.ts`, `DenyAllTenantAuthz` security tests,
  FORCE RLS / `sf_cmp060_rw` assertions in migration security tests.
- SF-CON-RISK-ASSESSMENT FROZEN shape: contract tests vs `contracts/m09/schemas/risk-assessment.schema.json`
  and valid/invalid examples.

## Scope
`logs/write-scope-diff.txt` lists paths under allowed write roots only. 0 lines changed in
`pnpm-lock.yaml`, `apps/**`, `contracts/**`, `orchestrator/contracts-lock.yaml`. Frozen contracts
unaltered; `ccr_required=false`.

## Residuals (explicit)
1. `EXPECTED_STITCH_A_LOCKFILE_ADMISSION_RESIDUAL` — new workspace importer needs a `pnpm-lock.yaml`
   row (not modified here); deferred to SF-M09-STITCH-A.
2. Host mount of `registerRiskRoutes` deferred to SF-M09-HOST; no UI.
3. Outbox table is a CMP-local producer insert shape; full SF-CON-OUTBOX publisher columns /
   `sf_outbox_publisher` policies may be aligned at stitch/host if required.
4. OPA policy data for risk actions lives in `policy/**` (read-only for this lane); until added the
   PDP denies (fail-closed) when a real PDP is wired.
5. PostgreSQL 16 FORCE RLS integration suite deferred to SF-M09-INT (podless builder).
6. G4=false · G6=false · CERTIFIED=false · self_certified=false.
