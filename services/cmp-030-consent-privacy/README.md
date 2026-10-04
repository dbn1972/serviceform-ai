# CMP-030 Consent & Privacy Service

Platform consent capture, purpose binding, withdrawal, privacy-notice versioning, and access-check machinery for ServiceForm AI (M01 / SF-M01-W2-002).

**Not CERTIFIED.** Host mount is deferred to SF-M01-W2-004.

## Scope

- Authoritative schema: `sf_consent_privacy`
- Privilege role: `sf_cmp030_rw` (ADR-0006 Option A)
- Eng interfaces: `POST/GET /consents`, `POST /consents/{id}/withdraw`, `POST /privacy/access-check`
- Supporting: purpose + privacy-notice create/publish (component-local OpenAPI)
- Events: `ConsentGranted`, `ConsentWithdrawn`, `PrivacyNoticeUpdated`

## Non-goals

- No DPDP Act / statutory privacy interpretation (ADR if required)
- No data deletion / retention enforcement (CMP-049)
- No IdP / citizen profile ownership (CMP-004/005)
- No CMP-061 citizen privacy centre UI
- No host registration in `apps/api`
