# SF-M01-005 (CMP-037) mandatory negative, deny and isolation tests

Author: security and tenant isolation verifier (Opus, xhigh), 3 Oct 2026. Written before code (MODEL-ROUTING-QUALITY s9).
Scope per dispatch: duplicate-callback, simulation-mode, secret-handling, webhook and tenant tests (the integration
stitcher remains the primary verifier). Inputs: SF-M01-005-plan.md, envelope, PLAN-REVIEW-M01-W1.md (read: schema
`sf_integration_hub`, Q1 **no SECURITY DEFINER**, `webhook_route` table, Q2 REAL for every PRODUCTION binding, Q4 no
null-tenant bindings in W1, Q11 same reference + different payload = idempotent + warning), connector-binding and
simulation-marker contracts, CONTRACT-REVIEW-001 CR-06/D-04.
**PLAN** = in builder plan s6; **NEW** = added by verifier. Gates: CTL cross_tenant_leakage, RLS
rls_required_negative_tests, FCC frozen_contract_conformance, PSC production_simulated_critical_connector, UCS
unresolved_critical_security, LOST lost_committed_applications.

## H. Harness rules
- H1. DB cases use a per-run `sf_t005_rt LOGIN NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app` with its own pool; never
  postgres, never `SET ROLE` from a superuser session (X-12); beforeAll asserts rolsuper/rolbypassrls false,
  session_user=current_user, not a member of the schema owner.
- H2. The provider double records every outbound call; "no provider call" means its counter is 0 and guardedFetch saw
  nothing. Canary secret `SFCANARY-<uuid>` is the only secret value used.

## A. Tenant isolation and catalogue
- **005-01** NEW RLS/UCS. H1 identity assertions. Exp: true or the suite fails.
- **005-02** PLAN RLS/CTL. connector_binding, connector_transaction, outbox_event, inbox_event x S/I/U/D x {own, other,
  unset, '' on a reused `max:1` backend}: other/unset/'' 0 rows, inserts refused; composite FK blocks a T1 transaction
  referencing a T2 binding; FORCE RLS on; no BYPASSRLS.
- **005-03** NEW UCS. Catalogue: zero `prosecdef` functions in sf_integration_hub (ruling Q1); no views or all
  `security_invoker=true`; sf_app has no TRUNCATE/TRIGGER/REFERENCES/CREATE; nothing to PUBLIC; no column whose name
  matches /secret|password|token|key_material|private/ other than `secret_ref`; connector_definition (GLOBAL) is SELECT-only.
- **005-04** NEW CTL/UCS. webhook_route (fix P-005-1): as rt under T1 INSERT a route for T2's binding id, INSERT with
  tenant_id T2, UPDATE any route's tenant_id, DELETE any route. Exp: refused (insert bound to current_tenant_id() and a
  composite FK (tenant_id, binding_id) to connector_binding; no UPDATE/DELETE grant). Route exposes only binding_id and
  tenant_id.
- **005-05** NEW CTL. Security-barrier ordering on connector_binding with `pg_temp.leak(secret_ref)` under T1: notices show
  only T1 handles; pg_stats shows no RLS table rows to rt after ANALYZE.
- **005-06** NEW CTL. Invoke cross-tenant: T1 invokes T2's binding id, a disabled binding and a random id. Exp: identical
  status and body (no existence oracle), no provider call, no row, no event; forged `x-tenant-id` or body `tenant_id`: 403/400.
- **005-07** NEW CTL. Idempotency-Key used by T2 and reused by T1 on the same binding id pattern: independent; T1 never
  receives T2's stored outcome.
- **005-08** NEW CTL. One backend: T1 invoke, then webhook resolving T2, then a webhook for an unknown binding. Exp: each
  sees only its tenant; the unknown webhook runs with no tenant setting.

## B. Webhook intake and duplicate callbacks
- **005-09** PLAN UCS. Bad, missing, stale or tampered signature, wrong binding: 401, no row, no event.
- **005-10** NEW CTL/UCS. Tenant confusion: route maps binding X to T1, callback signed with T2's binding secret: 401;
  unknown binding, other tenant's binding and disabled binding return identical status/body.
- **005-11** NEW UCS. Replay window and parser edge cases: timestamp older or newer than tolerance; timestamp header
  altered with body intact; duplicated signature header (array); non-hex or truncated signature (timingSafeEqual length
  mismatch must give 401, not 500); empty body; JSON re-serialised differently from the signed raw bytes (verification uses
  raw bytes); body over the size limit rejected with 413 **before** secret resolution.
- **005-12** NEW UCS. Order of operations: signature verified before any DB write or outbox insert; secret resolution
  failure: 503, nothing persisted; no DB transaction open during secret resolution or verification (no-txn guard).
- **005-13** PLAN LOST. 50 sequential and 50 parallel identical callbacks: exactly 1 connector_transaction and 1 outbox
  event; different reference: 2; same reference under another tenant's binding: independent; log to duplicate-callback.log.
- **005-14** NEW LOST/UCS. Same reference, different signed payload (e.g. PENDING then SUCCESS), ruling Q11: second
  returns the original, writes no event, emits a warning log and anomaly metric that contain no payload body; EVIDENCE.md
  lists this as a known limitation for M05 payment callbacks.
- **005-15** NEW UCS. 1,000 bad-signature callbacks: zero rows, bounded secret resolutions (cache), SF-RATE-001 after
  the configured rate; process memory stable.

## C. Mode resolution and simulation (gate PSC)
- **005-16** PLAN PSC/FCC. Matrix 8 environments x 3 modes x critical: forbidden combinations refused per contract;
  mode never rewritten; simulation-mode-matrix.md generated from the run.
- **005-17** NEW PSC. Ruling Q2: PRODUCTION + SANDBOX (critical or not) and PRODUCTION + SIMULATED (any) refused at startup
  (readiness false) and per call; PRODUCTION + REAL without secret_ref refused.
- **005-18** NEW PSC. Environment source: SF_ENVIRONMENT unset, empty, `production`, ` PRODUCTION`, unknown value: service
  refuses to start (fail closed). Binding row with environment SIT in a PRODUCTION deployment: refused per call, no
  provider call (binding.environment must equal deployed environment).
- **005-19** NEW PSC/UCS. Request cannot choose mode: body/query/header `mode`, `environment`, `simulation`,
  `x-sf-simulation: true`, `scenario` on a REAL binding: 400 or ignored; mode unchanged; no marker added.
- **005-20** NEW PSC. Post-startup flip: direct SQL UPDATE to SIMULATED on a PRODUCTION critical binding: DB CHECK refuses;
  a binding inserted after startup with environment SIT + SIMULATED in PRODUCTION: per-call guard refuses, zero calls.
- **005-21** NEW PSC. No fallback (Q4): tenant+service binding invalid against the contract or disabled: fails closed with
  BINDING_INVALID; it does not fall through to a tenant-level or default SIMULATED binding; static grep finds no code that
  substitutes SIMULATED for another mode.
- **005-22** NEW PSC/FCC. Marker integrity: SIMULATED result without marker, with another binding id, other environment,
  scenario not matching pattern, test_run_id empty or 129 chars: transaction FAILED / 400; REAL adapter result carrying a
  marker: rejected; every simulated result and event carries the marker and label TEST/SIMULATED.
- **005-23** PLAN PSC. Simulator refuses UAT/PREPROD/PRODUCTION; deterministic outputs; startup guard ignores disabled
  bindings and catches a mode change by the per-call guard.

## D. Secret handling
- **005-24** PLAN UCS. Canary secret absent from logs, responses, errors, events, connector_transaction rows and a full DB
  dump; SecretMaterial JSON/inspect redacted.
- **005-25** NEW UCS. secret_ref (the handle) absent from every HTTP response (health, invoke, webhook, errors) and event
  data: pattern `(aws-sm|aws-ssm|vault)://` never appears outside connector_binding and internal logs.
- **005-26** NEW UCS. secret_ref injection: `vault://a/../../root`, newline or space inside, `aws-sm://x?VersionStage=`,
  inline values (`sk_live_...`, PEM header, 40-char base64): refused by CHECK and contract; a REAL PRODUCTION binding
  pointing at the simulator namespace `vault://sim/...`: refused.
- **005-27** NEW UCS. Provider response sanitisation: provider error body and headers containing the canary and a PII
  sample are not stored in error_code/response_ref, not logged, not in events.
- **005-28** NEW UCS. SSRF (fix P-005-3): guardedFetch refuses 169.254.169.254, 127.0.0.1, ::1, 10/8, 172.16/12,
  192.168/16, fd00::/8, `file:`/`gopher:` schemes, a hostname resolving to a private IP at connect time, and any redirect
  to such targets; target hosts come only from connector_definition/config, never from request input.
- **005-29** NEW UCS. Egress bypass: static rule (depcruise or semgrep) that adapters and simulators/framework import no
  node:http, node:https, node:net, undici or global fetch; only guardedFetch.

## E. Invocation saga, no-txn guard, authz
- **005-30** PLAN UCS. AuthorizationPort deny: SF-AUTH-002, no provider call; missing ctx: SF-TEN-001.
- **005-31** PLAN UCS. Adapter called inside withTransaction: throws, zero calls; pg_stat_activity shows no
  `idle in transaction` and txid_current_if_assigned() is null at call time; async-context leakage cases.
- **005-32** PLAN LOST. Timeout -> retries -> circuit open -> Failed event with SF-INT-001/CIRCUIT_OPEN, Started exactly
  once; TX2 failure rolls back status and event together; idempotent replay; concurrent same key: one provider call.
- **005-33** NEW LOST/UCS. Crash after provider success and before TX2 (fix P-005-4): row stays IN_PROGRESS; a replay with
  the same Idempotency-Key returns an in-progress status (409/202) and does **not** call the provider again.

Totals: 33 cases, 24 NEW, 9 PLAN.
