# CMP-047 Observability Platform

M01 Wave 2 slice (SF-M01-W2-004). Shared primitives live in `@serviceform/observability`;
this package owns the Fastify access-log plugin and bootstrap helper.

## Responsibilities (Eng v1.4)

- OpenTelemetry instrumentation bootstrap
- Metrics / logs / traces with redaction
- Correlation ID propagation (host genReqId + response header)
- Query-string stripping in access logs (G-10)

## Non-responsibilities

- Does not log secrets or full PII
- Does not replace domain audit (CMP-031)

## REAL infra

CloudWatch / Prometheus / Grafana backends are out of scope without ADR; OTLP export is optional via `OTEL_EXPORTER_OTLP_ENDPOINT`.
