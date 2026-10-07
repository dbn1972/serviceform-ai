# CMP-028 Appeal / Review Service (SF-M05-008)

Status: builder output, **not verified, not certified**. Independent verification is a separate step.

Generic appeal/review: filing, link to original application/case/decision, grounds, evidence refs,
admissibility metadata, appellate authority metadata, workflow linkage (port), status, hearing/review
metadata refs, decision reference, audit/outbox.

## Rules

| Rule | Where |
|---|---|
| Original CMP-015 case is never rewritten by this service | No `sf_application_case` SQL; `CaseCommandPort` after commit only |
| Workflow is a port, not a second BPMN runtime | `WorkflowLinkPort`; no Temporal/BPMN engine in this package |
| Appellate authority = role + org/office + jurisdiction + scope | `src/domain/authority.ts`; no named-officer column |
| OPA on protected actions | `APPEAL_READ`, `APPEAL_ADMISSIBILITY`, `APPEAL_ASSIGN`/`REASSIGN`, `APPEAL_RECORD_REVIEW`, `APPEAL_RECORD_DECISION`, `APPEAL_WITHDRAW`/`CANCEL` |
| AI never decides | `AI_DECISION_FORBIDDEN` on protected mutations and forbidden note kinds |
| Tenant server-derived | `src/context.ts`; FORCE RLS |
| No I/O in txn | `src/tx-scope.ts` + `guardOutboundPort` |
| Outbox Day 1 | frozen SF-CON-OUTBOX template in `sf_appeal` |

Host mount is deferred to SF-M05-009. This package is dependency-free so `pnpm-lock.yaml` is untouched.
