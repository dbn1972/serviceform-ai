# pnpm-lock.yaml stitch summary (SF-M04-STITCH-A)

Compared to `origin/main` `9ccc2b02f8ef64a0987b0c4793137511545ed3f7`: **+222 / −2** lines. No existing package integrity hashes changed. No unrelated version moves.

## Importers added

- `services/cmp-008-rules` — `@fastify/rate-limit@11.2.0`, `@gorules/zen-engine@2.0.2`, `@serviceform/contracts` workspace, `fastify@5.12.5`, `pg@8.23.1`, `@types/pg@8.23.1`
- `services/cmp-011-evidence-requirements` — `@fastify/rate-limit@11.2.0`, `@serviceform/contracts` workspace, `fastify@5.12.5`, `pg@8.23.1`, `@types/pg@8.23.1`
- `services/cmp-013-document-upload` — `@serviceform/contracts` + `@serviceform/storage` workspace, `fastify@5.12.5`, `pg@8.23.1`, `@types/pg@8.23.1`
- `services/cmp-039-ai-gateway` — `@fastify/rate-limit@11.2.0`, `fastify-rate-limit` → `npm:@fastify/rate-limit@11.2.0`, `fastify-plugin@5.1.0`, `@serviceform/contracts` workspace, `fastify@5.12.5`, `pg@8.23.1`, `@types/pg@8.23.1`

## New resolved packages (only)

`@gorules/zen-engine@2.0.2` and optional platform packages at **2.0.2** (darwin/linux/win32/wasm32). Supporting: `@emnapi/core@1.11.3`, `@emnapi/wasi-threads@1.2.3`, `@napi-rs/wasm-runtime@1.2.4`, `@tybys/wasm-util@0.10.4`. Reused on main: `@emnapi/runtime@1.11.3`, `tslib@2.8.1`.

## Controls

`pnpm-workspace.yaml` `minimumReleaseAge: 10080`, `trustPolicy: no-downgrade`, `blockExoticSubdeps: true` unchanged. Root `onlyBuiltDependencies` unchanged. No `minimumReleaseAgeExclude`. Frozen-lockfile CI not weakened.
