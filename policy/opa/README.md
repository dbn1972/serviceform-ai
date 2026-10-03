# Common OPA bundle (CMP-048)

Governed authorization policy for ServiceForm AI. Tenant facts are never committed here.

- Package `sf.authz` evaluates `decision` (`allow`, `reason_code`, `policy_revision`).
- Default deny. Missing input, unknown action, tenant mismatch, missing tenant data, or OPA failure is a deny.
- Statutory eligibility belongs in GoRules (CMP-008), not in this bundle.
- Bundle roots: `sf`, `system/log`. Runtime grants live under `data.sf_runtime` (outside the bundle).
- `system/authz` is loaded by the authenticated test/deployable OPA process and is not a bundle root.

```
opa check --strict policy/opa
opa fmt --fail --list policy/opa
opa test -v --coverage policy/opa
opa build -b policy/opa --revision <sha>
```
