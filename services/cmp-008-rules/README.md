# CMP-008 Eligibility / Rules Engine

Deterministic evaluation of **pinned, published RULES metadata** with GoRules ZEN (embedded, no container).
Rule packs are authored in the Studio and published through CMP-033/CMP-052; this component contains no
service-, tenant- or statute-specific logic.

## Separation of responsibilities (Architecture Constitution #7)

| Concern                      | Owner                                                                            | In this component                                           |
| ---------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Who may evaluate             | OPA via `AuthorizationPort` (`RULE_EVALUATION_EXECUTE` / `RULE_EVALUATION_READ`) | action names only; no eligibility rule is expressed in Rego |
| Business / eligibility rules | GoRules ZEN (this component executes published JDM)                              | `ZenRuleEngine`, allow-listed node kinds                    |
| Process sequencing           | Temporal                                                                         | not used                                                    |
| Authoritative state          | PostgreSQL with FORCE RLS                                                        | `sf_rules` schema                                           |

No model call, AI Gateway client or LLM path exists here. Output is a rule result, not a final statutory
decision; the workflow/officer step owns approval or rejection.

## Interfaces

- `POST /v1/evaluations` (Idempotency-Key required) - body `{ rule_pack: {pack_key, version_id, content_hash}, inputs, purpose_code, subject_ref? }`
- `GET /v1/evaluations/{id}`

Callers (CMP-009 forms, CMP-011 evidence, workflow) consume this HTTP contract (`contracts/openapi.json`);
this component never imports their source. Published packs are obtained through `RulePackPort`
(deny-by-default; `SimulatedRulePackPort` for LOCAL/CI/SIT only, refused in PRODUCTION). The real adapter
and the host mount belong to SF-M04-007.

## Determinism and pinning

- The caller pins `{pack_key, version_id, content_hash}`; any mismatch with the resolved published pack fails closed.
- The pack payload is snapshotted (content-addressed, digest-checked, immutable) and each evaluation record
  stores the pin, input hash (raw inputs are not stored), outputs, matched rule ids, `result_code`, sorted
  `reason_codes`, engine name/version.
- Executable JDM node kinds: `inputNode`, `outputNode`, `decisionTableNode`, `expressionNode`, `switchNode`.
  `functionNode` (JavaScript), `customNode`, `httpRequestNode`, `decisionNode` are refused. Zero-argument clock
  or entropy calls (`d()`, `now()`, `rand()` ...) are refused; time-dependent rules take an `as_of` style input.
- Rule execution and the pack lookup happen before the authoritative transaction (no network or engine work
  inside it).

## Reason codes

`result_code` is platform-level (`RULE_OUTPUT_PRODUCED` | `NO_RULE_OUTPUT`). `outcome` and `reason_codes` are
read from pack-declared fields (`outcome_field`, `reason_codes_field`), validated against
`^[A-Z][A-Z0-9_]{1,63}$`, de-duplicated and sorted.

## Non-goals

Studio UI, host mount (SF-M04-007), real CMP-033/052 adapter, OPA bundle, CERTIFIED claim.
