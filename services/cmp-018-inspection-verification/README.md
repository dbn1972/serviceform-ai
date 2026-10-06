# CMP-018 Inspection / Verification Service (SF-M05-005)

Status: builder output, **not verified, not certified**. Independent verification is a separate step.

Reusable inspection/verification: request, scheduling **metadata** (not M09 CMP-056), assignment by
role + organisation/office + jurisdiction + service scope, checklist, observations, evidence refs,
findings, non-statutory verification result, re-inspection, audit.

## Rules

| Rule | Where |
|---|---|
| Verification is not statutory approval/rejection/eligibility | `verification_result` enum; `statutory_effect = false`; refuses APPROVED/REJECTED |
| CMP-015 remains authoritative | Case commands only via `CaseCommandPort` **after** domain commit; never SQL into CMP-015 |
| INT-006 evidence/OCR via ports | `EvidencePort`, `OcrPort`; no clone of CMP-011/013/014 |
| CMP-012 forbidden; DigiLocker SIMULATED only | `DigiLockerPort` + `assertSimulationPolicy`; production-critical SIMULATED fail-closed |
| Assignment is criteria only (Constitution #19) | `src/domain/assignment.ts` |
| Scheduling metadata only | `src/domain/scheduling.ts`; no departmental calendars |
| Tenant server-derived | `src/context.ts`; never trust `X-Tenant-ID` |
| Short PG txn + outbox; no network in txn | `src/tx-scope.ts`; OPA/ports before write |
| FORCE RLS, `sf_cmp018_rw` NOLOGIN | `db/migrations/1759540180000_cmp-018-inspection-verification.sql` |
| Host mount deferred | SF-M05-009; this package is transport-neutral |

## Tests

```bash
pnpm --dir services/cmp-018-inspection-verification test:unit
DATABASE_URL=... pnpm --dir services/cmp-018-inspection-verification test:integration
```

Lockfile admission is owned by STITCH-B. This package declares no npm dependencies.
