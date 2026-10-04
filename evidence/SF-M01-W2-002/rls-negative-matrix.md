# CMP-030 RLS / tenant-negative matrix (executed)

| Case | Result |
|---|---|
| Wrong-tenant SELECT on purpose | 0 rows |
| Peer component role DML (`sf_cmp048_rw`) | DENY |
| Client `x-tenant-id` header | HTTP 403 SF-TEN-002 |
| Cross-tenant GET /consents | empty items; no subject/consent leak |
| Authz deny CONSENT_GRANT | HTTP 403 SF-AUTH-002 |

`CROSS_TENANT_LEAKAGE=0` in executed builder suite. Independent SEC verifier still required.
