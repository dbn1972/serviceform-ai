# Platform components

One directory per architecture component, created by the module that owns it in the build
plan (none exist in M00):

```
services/cmp-002-tenant-organisation/
  src/        Fastify plugin + domain + repositories (registers under /v1/<component>)
  test/       unit, contract, tenant-negative and failure-path tests
  contracts/  OpenAPI / AsyncAPI / JSON Schema owned by this component
  migrations/ SQL migrations for the component's own schema
```

Rules (enforced by `.dependency-cruiser.cjs` and `scripts/gates/`):
- A component never imports another component; it uses `packages/contracts` and events.
- A component owns its schema; no cross-component SQL (Constitution #23).
- Components are hosted by `apps/api` as encapsulated Fastify plugins until scale, security
  or ownership justifies a separate deployable (DEVELOPMENT.md "Preferred implementation shape").
