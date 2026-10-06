# SF-M05-008 evidence — CMP-028 Appeal / Review

Builder evidence only. **Not CERTIFIED. Not G4. Not G6.** Do not merge. Do not start STITCH-B.

| Field | Value |
|---|---|
| Task | SF-M05-008 |
| Component | CMP-028 |
| Dispatch base | `ca57057a794739c03d0a46886577e25adf041815` |
| `dispatch_authorized` | true |
| Branch | `agent/M05-appeal-SF-M05-008` |
| Schema | `sf_appeal` |
| Privilege role | `sf_cmp028_rw` NOLOGIN, no SUPERUSER, no BYPASSRLS |
| RLS | ENABLE + FORCE on every TENANT_SCOPED table |
| CCR_REQUIRED | false |
| Frozen contracts | 19/19 FROZEN MATCH, unchanged |
| Lockfile | not committed |

## Local executed checks

| Suite | Result |
|---|---|
| Unit + contract | 31 passed (`logs/unit.log`, `junit/unit-contract.xml`) |
| PostgreSQL integration | 10 passed (`logs/integration.log`, `junit/integration.xml`) |
| `pnpm db:test` | 17/17 passed (`logs/dbtest.log`) |
| Architecture gates | 10/10 (`logs/gates.log`) |
| Scope vs envelope | PASS (`logs/scope.log`) |
| Contracts lock | 19 FROZEN (`logs/contracts-lock.log`) |
| Migration lint | PASS (`logs/migration-lint.log`) |
| Lint / typecheck | PASS (empty `logs/lint.log`, `logs/typecheck.log`) |

## Acceptance mapped

- Appeal does not rewrite original CMP-015 case except via `CaseCommandPort` after commit (unit: original-case tests; SQL guard; privilege-rls denies `sf_application_case`).
- OPA on view, admissibility, assign/reassign, record review, record decision reference, withdraw/cancel (unit negative + API int).
- AI cannot decide admissibility/approval/rejection/penalty/eligibility/final legal outcome.
- Host mount deferred (no `apps/**` writes).

CI / Security / Developer-platform on the immutable PR head will be recorded after freeze.
