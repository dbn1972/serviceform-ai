# SF-M01-W2-001 evidence — CMP-003 Jurisdiction

| Field | Value |
|---|---|
| Task | SF-M01-W2-001 |
| Component | CMP-003 |
| Branch | `cursor/m01-w2-cmp-003-e34d` |
| Base | `origin/main` @ `f397e13` |
| Head SHA | `912cd05f7c8977a60d9a3454c5869036cc0affe7` |
| PR | https://github.com/dbn1972/serviceform-ai/pull/26 |
| Self-certified | **false** |
| Not certified | **true** |
| Recommended gate | IMPLEMENTATION_READY (builder); independent Verify not run by builder |

## Executed locally

| Suite | Result | Artifact |
|---|---|---|
| Unit + contract | PASS (8) | `evidence/SF-M01-W2-001/junit/unit.xml` |
| Integration | PASS (6) | `evidence/SF-M01-W2-001/junit/integration.xml` |
| Typecheck | PASS | log in `evidence/SF-M01-W2-001/logs/` |

Commands (with `DATABASE_URL` pointing at disposable PG16):

```bash
pnpm --filter @serviceform/cmp-003-jurisdiction run test:unit
pnpm --filter @serviceform/cmp-003-jurisdiction run test:integration
pnpm --filter @serviceform/cmp-003-jurisdiction run typecheck
```

## Acceptance mapping

| Acceptance | Evidence |
|---|---|
| Org hierarchy not owned | No `sf_tenant_org` references in CMP-003 SQL/src |
| No hard-coded level names | Domain type codes configurable; migration test asserts absence of STATE/DISTRICT/… |
| RLS + privilege boundary | `privilege-boundary.int.test.ts` |
| Outbox template byte-for-byte | `test/contract/contracts.test.ts` |
| Unauthorized / wrong-tenant / forged headers | `api.int.test.ts` |
| Cycle + unknown address fail closed | `api.int.test.ts` |
| Host mount deferred | Plugin export only; no `apps/api` writes |

## Residuals

- See `CI-RESIDUAL.md`: five install-gated CI jobs fail solely on frozen `pnpm-lock.yaml` missing the cmp-003 importer (orchestrator stitch). Semgrep ReDoS fixed in-scope.
- Wave 2 envelope INT CI job (W1-only today) not extended here (owned by SF-M01-W2-005).
- Not CERTIFIED.
