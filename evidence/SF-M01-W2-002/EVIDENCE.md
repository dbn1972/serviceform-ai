# SF-M01-W2-002 evidence — CMP-030 Consent & Privacy

**Recommended gate:** READY_FOR_INDEPENDENT_VERIFY  
**CERTIFIED:** false (builder cannot self-certify)  
**Self-certified:** false

| Field | Value |
|---|---|
| Task | SF-M01-W2-002 |
| Component | CMP-030 |
| Branch | `cursor/m01-w2-cmp-030-4362` |
| Base | `origin/main` @ `f397e13` |
| Schema | `sf_consent_privacy` |
| Privilege role | `sf_cmp030_rw` |

## Executed checks

| Check | Result |
|---|---|
| `pnpm --filter @serviceform/cmp-030-consent-privacy typecheck` | PASS |
| Unit + contract (`test:unit`) | **12 passed** |
| Integration (`test:integration`) | **6 passed** |
| Coverage (unit+contract+integration) | lines **84.36%**, stmts **79.8%**, funcs **92%**, branches **59.39%** |
| `migration_lint.py` | PASS (0 errors) |
| `check_scope.py` vs envelope | PASS |

## Acceptance mapping

| Acceptance | Evidence |
|---|---|
| Deny when purpose/consent required but missing | `api-flow.int.test.ts` access-check → `MISSING_CONSENT` |
| Withdrawal auditable + idempotent | withdraw + repeated Idempotency-Key; outbox `ConsentWithdrawn` + `AuditEventSubmitted` |
| Wrong-tenant / unauthorized zero leakage | privilege + API forged header / cross-tenant list |
| ADR-0006 FORCE RLS + privilege boundary | `privilege-boundary.int.test.ts`, migration static checks |
| Outbox template unchanged | `contracts.test.ts` byte-contains frozen template |
| Host mount deferred | no `apps/api` changes |

## Artifacts

- `junit/unit.xml`, `junit/integration.xml`
- `coverage/`, `coverage-summary.json`
- `unit.log`, `integration.log`, `unit-coverage.log`, `lint-typecheck.log`
- `scope-check.log`, `migration-lint.log`, `privilege-boundary.log`, `rls-negative-matrix.md`

## Residuals / non-claims

- Independent INT / SEC / EVD verifiers not executed by this builder
- Host composition deferred to SF-M01-W2-004
- DPDP statutory anchors not invented (platform mechanics only)
- `pnpm-lock.yaml` not modified (orchestrator regen)
- Module/release **not CERTIFIED**
