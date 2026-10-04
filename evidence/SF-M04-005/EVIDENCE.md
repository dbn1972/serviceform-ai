# SF-M04-005 CMP-009 Dynamic Forms Engine — builder evidence

**Not VERIFIED. Not CERTIFIED. Not G6. M05 OFF.** Builder recommendation only.

| Field | Value |
| --- | --- |
| Task | SF-M04-005 |
| Component | CMP-009 |
| Base | `origin/main` @ `2db721feb1303385a0c50c79de8629b2478064d9` |
| Branch | `cursor/m04-forms-sf-m04-005-a1bc` |
| Head SHA | pending-semgrep-fix |
| PR | https://github.com/dbn1972/serviceform-ai/pull/74 (draft, do not merge) |
| Privilege role | `sf_cmp009_rw` NOLOGIN |
| Schema | `sf_forms` |
| Contracts | 13/13 FROZEN (untouched) |

## Executed locally

| Check | Result |
| --- | --- |
| Unit + contract (30) | PASS (`junit/unit.xml`) |
| Integration RLS/privilege/migration (9) | PASS (`junit/integration.xml`) |
| Architecture gates | 10/10 PASS (`logs/gates.log`) |
| migration_lint | PASS |
| eslint `services/cmp-009-dynamic-forms` | PASS `--max-warnings=0` |
| `tsc --noEmit` | PASS |

CodeQL `js/polynomial-redos` on `EMAIL_RE` (`schema.ts` at `10ea29d`/`96ea419`) replaced with a linear `isEmailFormat` scan. Semgrep `prototype-pollution-loop` on `readPath` (`ui-schema.ts`) closed: forbidden pointer segments `__proto__`/`constructor`/`prototype`; own-property lookup via `Object.hasOwn` + `getOwnPropertyDescriptor` (no prototype walk). Isolated frozen-lockfile CI red remains `EXPECTED_STITCH_B_LOCKFILE_RESIDUAL`.

## Tenant / RLS

- Server-derived context only; `x-tenant-id` / `x-sf-*` denied (`SF-TEN-002`)
- ENABLE + FORCE RLS on tenant tables; runtime LOGIN not owner, not SUPERUSER, not BYPASSRLS
- `sf_cmp009_rw` NOLOGIN; peer `sf_cmp051_rw` cannot DML `sf_forms`
- CROSS_TENANT_LEAKAGE=0 in unit + PostgreSQL integration

## Residual

`EXPECTED_STITCH_B_LOCKFILE_RESIDUAL`: new workspace importer `@serviceform/cmp-009-dynamic-forms` is not in `pnpm-lock.yaml` (builders must not commit the lockfile). Isolated CI red only at `pnpm install --frozen-lockfile` is expected until STITCH-B. Frozen-lockfile CI, `minimumReleaseAge`, `trustPolicy`, `blockExoticSubdeps`, `.npmrc`, and `pnpm-workspace.yaml` were not weakened.

Host mount remains SF-M04-007. Do not merge this PR as Wave B stitch.
