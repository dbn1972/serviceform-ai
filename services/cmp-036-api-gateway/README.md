# CMP-036 API Gateway / Edge Contract

M01 Wave 2 Fastify edge slice (SF-M01-W2-004). Host composition of Wave 1 component
plugins lives in `apps/api` (single writer); this package owns edge concerns only.

## Responsibilities (Eng v1.4)

- Ingress rate limits
- Request / correlation IDs (with host)
- Forged client tenant / identity header denial

## Non-responsibilities

- Domain authorization (OPA / CMP-048)
- Heavy business-semantic transformation
- CloudFront / WAF / ALB REAL infrastructure (ADR required)

## Cross-component rule

This service must not import other `services/cmp-*` packages. Plugin mounting is `apps/api` only.
