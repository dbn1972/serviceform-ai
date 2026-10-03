# SF-M01-002 deny matrix (executed)

Builder-executed evidence only. Independent security/evidence verifiers remain the hard-gate owners. Status: **pass** = executed and observed; **partial** = core deny observed, not every listed variant; **gap** = not executed in this branch (residual for verifier).

## ADR-0006 privilege-boundary

| ID | Result | Evidence |
|---|---|---|
| PB-01 sf_cmp048_rw NOLOGIN NOSUPERUSER NOBYPASSRLS | pass | privilege-boundary.log |
| PB-02 runtime IN ROLE sf_app + sf_cmp048_rw only | pass | privilege-boundary.log |
| PB-03 rolsuper/rolbypassrls false | pass | privilege-boundary.log |
| PB-04 table/sequence owner = sf_migrator | pass | privilege-boundary.log |
| PB-05 own authorized INSERT/SELECT | pass | privilege-boundary.log |
| PB-06 T2 / empty tenant isolated on one backend | pass | privilege-boundary.log |
| PB-07/11 peer sf_app-only 42501 on authoritative tables | pass | privilege-boundary.log |
| PB-08 peer SET ROLE sf_cmp048_rw fails | pass | privilege-boundary.log |
| PB-09 runtime SET ROLE sibling _rw fails | pass | privilege-boundary.log |
| PB-10 GRANT sibling as runtime 42501 | pass | privilege-boundary.log |
| PB-12 PUBLIC USAGE false | pass | privilege-boundary.log |
| PB-13 sf_app no INSERT/UPDATE/DELETE on four authoritative tables | pass | privilege-boundary.log |
| PB-14 outbox block = rendered frozen template | pass | outbox-template.test.ts |
| PB-15 no OWNER / NO FORCE RLS / DROP POLICY | pass | privilege-boundary.log |

## Verifier 002-01..002-35

| ID | Area | Result | Notes |
|---|---|---|---|
| 002-01 | H1 identity | pass | rls-negative |
| 002-02 | RLS matrix | partial | T1/T2/empty on privileged_access_record; not full S/I/U/D × all tenant tables |
| 002-03 | Outbox grants | partial | template byte-match; no live outbox wrong-tenant insert suite |
| 002-04 | FORCE RLS / no DEFINER | pass | rls-negative |
| 002-05 | Owner-bypass | partial | PB-15; no session_replication_role / DISABLE TRIGGER |
| 002-06 | Grant minting | partial | INSERT APPROVED + self-approval refused; not every illegal transition |
| 002-07 | Window / immutability | pass | CHECK + column-grant deny (permission denied before trigger) |
| 002-08 | Policy activation | pass | maker-checker + one ACTIVE |
| 002-09 | PEP-bypassed RLS | partial | covered by PB-06 under runtime login |
| 002-10 | Approve/revoke race | gap | residual |
| 002-11 | R1–R14 | pass | opa test 48/48 |
| 002-12 | Tenant confusion | pass | opa decision_test |
| 002-13 | Undefined-safety + mutation | partial | mutation on tenant.rego executed; not every helper field matrix |
| 002-14 | Break-glass misuse | pass | opa grant tests |
| 002-15 | OPA API surface | pass | pep-opa.int + system.authz tests |
| 002-16 | Static bundle | pass | opa-bundle.int |
| 002-17 | Decision log mask | partial | PEP allowlist/canary; not OPA console sink capture |
| 002-18 | P1–P11 | pass | plugin + pdp-client.fault + canary |
| 002-19 | Local tenant pre-check | pass | plugin.test |
| 002-20 | Smuggling | partial | html / empty / string-allow; not 50MB / concat / revision pin |
| 002-21 | Redirect / SSRF | pass | pdp-client.fault |
| 002-22 | Half-open stampede | partial | circuit-breaker unit only |
| 002-23 | Boot coverage | partial | undeclared + sfPublic+sfAuthz; not child-plugin/HEAD/404 |
| 002-24 | Forged headers | partial | x-tenant-id; not 100 randomised headers |
| 002-25 | Deep freeze | pass | plugin.test |
| 002-26 | Verifier faults | gap | residual |
| 002-27 | Secrets/KMS redaction | pass | secret-value + local-kms |
| 002-28 | Path / env lock | pass | local-secrets-provider |
| 002-29 | KMS AAD / IV | pass | local-kms (200 IVs; not 100k) |
| 002-30 | SecretValue surfaces | partial | toString/toJSON/inspect; not every listed surface |
| 002-31 | Events / migrate | pass | events + migration-roundtrip + outbox template |
| 002-32 | Incident tenant | partial | envelope has no header values |
| 002-33 | Audit same-tx | partial | command unit with mocked client |
| 002-34 | Revoke push retry | pass | service-commands (5 retries + incident) |
| 002-35 | Metric / log allowlist | pass | decision-log-canary (1000 lines) |

Positive controls: own INSERT/SELECT (PB-05), OPA allow path in opa tests, plugin allow when PDP allows, KMS round-trip, valid envelopes.
