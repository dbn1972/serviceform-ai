# CMP-020 Fee & Calculation Service

Deterministic fee quotes for applications (Eng v1.4 CMP-020; first hop of INT-007). Produces
`SF-CON-FEE-QUOTE` v1 (FROZEN, `contracts/m06/schemas/fee-quote.schema.json`).

Status: SF-M06-001 builder output. Not CERTIFIED, not G3, not G6. Host mount deferred to SF-M06-005.

## Ownership (schema `sf_fee`, role `sf_cmp020_rw`, ADR-0006)

CMP-020 owns issued fee quotes and their lines. It holds **no fee schedule, rate table, waiver or
exemption rule**. Every amount comes from governed, pinned metadata:

| Input | Source (port) | Pin |
|---|---|---|
| `tenant_service_binding_id`, `rule_version_id`, `fee_policy_version_id` | CMP-015 pin graph (`ApplicationPinsPort`) | SF-CON-VERSION-PINNING |
| Fee lines, currency, waiver ref | Published fee-policy version (`FeePolicyPort`; CMP-033/052 via CMP-051) | `fee_policy_version_id` |
| Rule-sourced line amounts | CMP-008 evaluation (`FeeRulesPort`) | `rule_version_id` |

Clients cannot supply amounts, currency, waivers or pins (`CLIENT_AMOUNT_FORBIDDEN`). Rule facts
are optional deterministic inputs; fact names that read as outcomes are refused, and facts are
hashed, never stored or logged. An application with no `fee_policy_version_id` pin is refused
(`FEE_POLICY_NOT_PINNED`); no default amount exists. Unbound ports fail closed (`SF-SYS-004`).

## Calculation

- Integer minor units only, carried as `bigint`; fractional, negative, exponent or unsafe values
  are refused rather than rounded. No floating point participates.
- Line order follows the published policy. `FIXED_AMOUNT` → `FEE_POLICY_LINE`; `RULE_OUTPUT` →
  `RULES_ENGINE_LINE` (amount read from the named output of the pinned evaluation).
- `amount_source` is `RULES_ENGINE` when any line is rule-sourced, else `FEE_POLICY_METADATA`.
- Identical governed inputs (pins, policy content hash, rule content hash, facts hash) map to one
  immutable quote (`calculation_hash`); a repeat returns it with `200`.

## Transactions

All port calls (OPA, pins, fee policy, rules) happen before the transaction. The transaction
claims idempotency, inserts the quote and lines, the `FeeQuoteIssued` outbox event and the audit
event, then completes idempotency. A deferred constraint trigger enforces at commit that a quote has
lines, its total equals the exact sum of its lines, and `amount_source` matches line bases. Quotes
and lines are insert-only (`42501` on update/delete).

## API (component-local `contracts/openapi.json`)

- `POST /v1/fee-quotes` `{ application_id, facts? }` (Idempotency-Key required) → 201 / 200
- `GET /v1/fee-quotes/{quote_id}`
- `GET /v1/applications/{application_id}/fee-quotes`

Events: `FeeQuoteIssued` on `sf.fee.events.v1`; audit on `sf.audit.ingest.v1`.

## Tests

`pnpm --filter @serviceform/cmp-020-fee-calculation test:unit` and `test:integration`
(`DATABASE_URL` required). The package declares no dependencies.
