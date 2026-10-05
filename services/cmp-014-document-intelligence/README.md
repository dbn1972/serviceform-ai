# CMP-014 Document Intelligence / OCR Service

Assistive OCR orchestration, document classification and structured extraction (Eng v1.4 CMP-014).
**All model inference goes through CMP-039.** This service never calls Bedrock, OpenAI, Anthropic,
Textract, Tesseract or any other provider SDK. Outputs are advisory only: they do not establish
statutory eligibility, approve/reject, satisfy evidence, issue entitlements, override deterministic
rules, or replace officer decisions.

## Eng interfaces

- `POST /v1/extraction-policies` (Idempotency-Key) — insert-only confidence/content-type pins plus
  CMP-039 policy id/version
- `POST /v1/intelligence-jobs` (Idempotency-Key) — accepts a CMP-013 source document ref + checksum
- `POST /v1/intelligence-jobs/{id}/process` — SIMULATED OCR, local classify/redact, then CMP-039 invoke
- `GET /v1/intelligence-jobs/{id}` — assistive result + provenance (model pin, prompt hash, source ref)
- `POST /v1/intelligence-jobs/{id}/review` — human review for low confidence (`CONFIRM_ASSISTIVE` / `DISCARD`)

## Lifecycle

`ACCEPTED -> CLASSIFYING -> EXTRACTING -> COMPLETED | NEEDS_REVIEW | FAILED`. Unsupported/malformed
documents `ACCEPTED -> REJECTED`. `NEEDS_REVIEW -> REVIEWED` never becomes a statutory decision.

## Ports

- `OcrPort` — SIMULATED adapter only (INT-013). REAL OCR requires a later connector ADR.
- `AiGatewayPort` — the only inference path (CMP-039)
- `SourceDocumentPort` / `SourceAclPort` — tenant/source ACL; no cross-component SQL
- `AuthorizationPort` — OPA PEP, fail closed

## Non-goals

- Host mount (`apps/api`) — SF-M04-007
- REAL OCR connector deployment
- Importing or merging SF-M04-005
