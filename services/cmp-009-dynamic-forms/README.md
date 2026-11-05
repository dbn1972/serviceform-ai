# CMP-009 Dynamic Forms Engine

JSON Schema form runtime with UI-schema interpretation, conditional visibility, required-field
evaluation, and **server-side authoritative validation** of pinned published FORM metadata.

JSON Forms is schema/runtime only. Visual widgets are UX4G-backed renderer ids compatible with
CMP-054 (`packages/ui-ux4g`). This package does not fork UX4G primitives or host product UI
(CMP-050 Studio remains Studio; host mount is SF-M04-007).

## Interfaces

- `POST /v1/interpretations` — interpret a pinned published form (not authoritative)
- `POST /v1/executions` (Idempotency-Key required) — authoritative validation
- `GET /v1/executions/{id}`

Callers consume `contracts/openapi.json`. Published forms are obtained through `FormDefinitionPort`
(deny-by-default; `SimulatedFormDefinitionPort` for LOCAL/CI/SIT only). Localization uses
`LocalizationPort` matching the CMP-053 resolve contract. No SQL into CMP-008/011/050/053/054.

## Validation keywords

`type`, `enum`, `const`, `minLength`/`maxLength`, `minimum`/`maximum`, `minItems`/`maxItems`,
`format` (`date`, `date-time`, `email`, `uuid`), `required` (including root `if`/`then`/`else`),
`additionalProperties: false`, and a bounded `pattern` subset: anchored (`^…$`) sequences of
character classes, `\d` and literals with `{n}`, `{n,m}` (≤ 64) or `?`. Patterns outside the subset
are refused when the form is parsed (`SCHEMA_PATTERN_UNSUPPORTED`). Matching uses no RegExp
engine and is linear in input length. Unknown keywords (`x-ux4g`, `semanticElementId`) are ignored.

## Authorization

OPA actions `FORM_INTERPRET` (`FormDefinition`), `FORM_EXECUTION_EXECUTE` and `FORM_EXECUTION_READ`
(`FormExecution`). Execute sends `owner_id = actor.id`, so a citizen passes the citizen-owner path
(CCR-M10-002); interpret uses the citizen published-metadata grant.

## Pinning

The caller pins `{form_key, version_id, content_hash}`. Unpublished or mismatched pins fail closed
(`SF-FORM-001`). Instance field values are not stored; `data_hash` is recorded.

## Non-goals

Studio UI, host mount (SF-M04-007), second design system, named-service branching, CERTIFIED claim.
