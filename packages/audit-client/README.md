# @serviceform/audit-client

Producer-side helpers for CMP-031. Builds and validates `AuditEvent` / `AuditEventSubmitted` values for a component's **own** outbox. Does not open database connections or write SQL (PLAN-REVIEW X-4, X-6).
