# CMP-060 Risk, Fraud & Integrity Service

SF-M09-005. Non-authoritative integrity risk assessments bound to the FROZEN
`SF-CON-RISK-ASSESSMENT` contract. Emits explainable advisory signals and routes
HIGH/CRITICAL cases for authorized human review (INT-018).

- **`authoritative_decision_by_this_component` is always `false`.** Enforced in the
  TypeScript domain gate, the service response shape, the outbox payload, and a
  PostgreSQL `CHECK` / transition trigger on `sf_risk.risk_assessment`.
- **Signals are advisory only.** Codes that encode statutory outcomes
  (`APPROVE`, `REJECT`, `ELIGIBLE`, …) are refused with `422 SF-AI-001`.
- **Raw score alone cannot reject.** Tier classification is deterministic and
  advisory; adverse effects require GoRules policy or an authorized human
  disposition (`CLEARED` / `ESCALATED` / `REFERRED_ENFORCEMENT`).
- **INT-011 tenant isolation.** Tenant identity comes only from the host-resolved
  request context. Caller `tenant_id` in body/headers is refused. Data access is
  FORCE RLS on `sf_risk.*` under privilege role `sf_cmp060_rw` (NOLOGIN).
- **INT-018 review routing.** HIGH/CRITICAL assessments transition to
  `HIGH_RISK_REVIEW_REQUESTED` and emit `sf.risk.assessment.review_requested.v1`.
  Disposition is recorded by an officer; this component never decides.

Schema: `sf_risk`. Privilege role: `sf_cmp060_rw`. Host mount deferred to
SF-M09-HOST; `pnpm-lock.yaml` admission deferred to SF-M09-STITCH-A. No UI.

Routes: `POST /v1/risk/assessments`, `GET /v1/risk/assessments/:id`,
`POST /v1/risk/assessments/:id/review`.
