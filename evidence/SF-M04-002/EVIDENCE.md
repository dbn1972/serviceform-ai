# SF-M04-002 evidence - CMP-008 Eligibility / Rules Engine

**Not CERTIFIED. Not VERIFIED. Not RELEASE CERTIFIED. Not G6. M05 OFF.** Builder self-certification is false.
Recommended gate state (human/CI decides): **IMPLEMENTATION_READY**.

| Field | Value |
|---|---|
| Task | SF-M04-002 |
| Component | CMP-008 (INT-011 re-verified later by independent INT) |
| Base | `origin/main` `9ccc2b02f8ef64a0987b0c4793137511545ed3f7` |
| Branch | `cursor/cmp-008-rules-engine-7da8` |
| Code commit (all logs below executed at this SHA) | `1244fdf8967b3387e6b91b00f7f2a7a3789aac67` |
| Model / effort | Cursor cloud agent (Claude Sonnet 5.5 route per envelope, effort high) |
| Frozen contracts | 13/13 FROZEN / MATCH; `contracts/**` and `orchestrator/contracts-lock.yaml` untouched; no CCR |
| `pnpm-lock.yaml` | not committed (STITCH-A) |
| Runtime | local PostgreSQL 16.15 (CI pins 16.14); Node 22.14; `@gorules/zen-engine` 2.0.2 |

Final PR head SHA is the head of the PR branch (this evidence/handover commit sits on top of the code commit).

## Hard checks and where they are executed

| Hard check | Executed evidence |
|---|---|
| Deterministic GoRules ZEN | `engine.test.ts` (25 concurrent runs identical, no input mutation, no-match -> empty outputs, no default decision); `plugin-http.test.ts` and `rls-api.int.test.ts` repeat-evaluation equality |
| Deterministic metadata only | `jdm.test.ts`: `functionNode`, `customNode`, `httpRequestNode`, `decisionNode`, unknown nodes refused; zero-argument clock/entropy calls (`d()`, `now()`, `rand()`, `uuid()` ...) refused; cycles, dangling edges, oversize refused |
| No eligibility rules in OPA | `constitution.test.ts`: no `.rego` in component; `authz.ts` contains action names only and no rule vocabulary; README separation table |
| No LLM statutory path | `constitution.test.ts`: no LLM/AI-gateway/model-client tokens in `src/` or `package.json`; no `cmp-039` import; response carries `decision_basis: DETERMINISTIC_RULES` |
| Pinned / versioned execution | caller pins `{pack_key, version_id, content_hash}`; port result must match pin and be `PUBLISHED`; content-addressed immutable `rule_pack_snapshot` with digest check (`RULE_PACK_PIN_MISMATCH`, `RULE_PACK_DIGEST_MISMATCH` tests); evaluation row stores pin, engine name/version |
| Deterministic reason codes | `result_code` (`RULE_OUTPUT_PRODUCED` / `NO_RULE_OUTPUT`) plus pack-declared `outcome` / `reason_codes`, pattern-validated, de-duplicated, sorted (test: `[ZETA,ALPHA,ZETA]` -> `[ALPHA,ZETA]`); invalid -> SF-RULE-001 |
| No hard-coded legislation / named service | `constitution.test.ts` scans `src/` for service, statute and tenant/jurisdiction branching tokens; fixtures use neutral threshold packs; hardcoding gate PASS |
| Tenant isolation / FORCE RLS | `migration.int.test.ts`, `privilege-boundary.int.test.ts`, `rls-api.int.test.ts` (below) |
| No network in authoritative transaction | `constitution.test.ts`: pack resolve and engine run before `withContextTx`; none inside it |
| No imports of sibling source | `constitution.test.ts` + dependency-cruiser PASS (829 modules) |

## Results (builder-executed; logs in `logs/`, JUnit in `junit/`)

| Check | Result |
|---|---|
| typecheck (`tsc --noEmit`) | PASS |
| eslint (`--max-warnings=0`) on component | PASS |
| prettier check (component, migrations, handovers) | PASS |
| unit + contract (`test:unit`) | 56 passed |
| same under root `vitest run services/cmp-008-rules` | 56 passed |
| integration (real PostgreSQL + real ZEN) | 14 passed |
| component line coverage (unit) | 94.9% lines / 92.1% statements / 85% branches |
| migration_lint | PASS (35 files) |
| architecture gates `run_all.py` | 10/10 PASS (contracts-lock: 13 contracts, 13 FROZEN) |
| dependency-cruiser | PASS, no violations |
| `contracts:validate` | PASS |
| check_scope vs `orchestrator/tasks/SF-M04-002.yaml` | PASS (49 files at code commit, all inside allowed paths) |
| `pnpm install --frozen-lockfile` | **FAIL (expected Wave A residual)**: lockfile lacks the new importer; see below |

## Tenant / RLS / privilege results (`logs/db-roles-rls-grants.log`)

- `CROSS_TENANT_LEAKAGE = 0`: tenant 2 cannot GET tenant 1 evaluations (404), cannot resolve tenant 1 packs (404), and a runtime session scoped to tenant 2 reads 0 rows from `evaluation_record`, `rule_pack_snapshot`, `idempotency_record`; a port returning another tenant's pack is denied (403, SF-TEN-002).
- Unset tenant session returns 0 rows; inserting a row for another tenant fails RLS `WITH CHECK`; composite FK blocks cross-tenant snapshot references.
- Runtime login: `rolsuper=f`, `rolbypassrls=f`, not a member of the `sf_migrator` owner role, no `CREATE` on schema `sf_rules`.
- `sf_cmp008_rw`: NOLOGIN, NOSUPERUSER, NOBYPASSRLS; grants are SELECT/INSERT only on snapshot and evaluation tables (idempotency adds DELETE and column UPDATE); PUBLIC has no table or schema privilege; peer privilege role cannot DML.
- Tables `rule_pack_snapshot`, `evaluation_record`, `idempotency_record`, `outbox_event`, `inbox_event`: ENABLE + FORCE RLS, owner `sf_migrator`. `*_platform` tables are PLATFORM_OPERATIONAL (declared).
- Snapshot and evaluation records are append-only (trigger `SF_RECORD_IMMUTABLE`, also fires for superuser); runtime has no UPDATE/DELETE/TRUNCATE.
- Raw inputs are never persisted (`input_hash` only); audit event class `DECISION` with `reason=result_code`.
- Down migration removes the schema and keeps the role; up restores it (test).

## Dependency note

`@gorules/zen-engine` is pinned to 2.0.2 (the newest releases are younger than the repository 7-day `minimumReleaseAge`).
A local `pnpm install --no-frozen-lockfile --config.minimumReleaseAge=0` was used only to test; the resulting
lockfile diff was discarded and is not part of this change.

## Residuals (none block this slice's builder scope; all owned elsewhere)

1. `pnpm install --frozen-lockfile` fails until SF-M04-STITCH-A admits the `services/cmp-008-rules` importer and `@gorules/zen-engine@2.0.2` (builders must not commit `pnpm-lock.yaml`). Lockfile-dependent CI jobs therefore cannot go green on this PR alone.
2. Real `RulePackPort` adapter (CMP-033/CMP-052 published RULES) and OPA policy entries for `RULE_EVALUATION_EXECUTE|READ` are host/integration work (SF-M04-007 / INT).
3. Static non-determinism screening (zero-argument clock/entropy calls) is a guard, not a formal proof; time-dependent rules must take an explicit `as_of` input.
4. Independent INT / SEC / EVD verification not performed by the builder.
