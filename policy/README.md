# Authorization policy (OPA)

Governed ServiceForm authorization policy model (AWS v1.7 s20.3-20.6). Built in M01 with the
OPA baseline; empty in M00.

- `opa/` is the common policy bundle root. Tenant differences are policy **data**, never
  per-tenant Rego (s20.4).
- The PDP contract is `packages/contracts/schemas/authz-decision.schema.json`.
- Policy changes need Rego unit tests (`opa test`) and maker-checker publication; PEPs fail
  closed when no valid decision is available (s20.6).
