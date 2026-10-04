# CMP-051 Maker-Checker / Publishing Service

Maker submit and checker approve/reject for TenantServiceBinding publication (INT-002, INT-011, INT-013 SIMULATED/fail-closed). CMP-043 AI review is advisory and must not block.

## Eng interfaces

- `POST /v1/publication-requests`
- `GET /v1/publication-requests/{id}`
- `POST /v1/publication-requests/{id}/submit`
- `POST /v1/publication-requests/{id}/approve`
- `POST /v1/publication-requests/{id}/reject`

Checker must be a different principal than the maker. Approved/rejected decisions are immutable.

## Non-goals

- Studio / admin portal UI (SF-M03-007)
- Host plugin mount (SF-M03-008)
- Mutating published versions
- CERTIFIED claim
