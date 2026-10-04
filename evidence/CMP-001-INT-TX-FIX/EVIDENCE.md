# CMP-001 INT test transaction fix (not CERTIFIED)

| Field | Value |
|---|---|
| Decision | Verification-test transaction defect, not a production privilege defect |
| Component | CMP-001 |
| INT | INT-011 (privilege boundary / ADR-0006) |
| Base | `origin/main` `7424235592824d5ceda9dcac55380a78c05cb6c5` (merge #57) |
| Branch | `cursor/cmp-001-int-test-tx-fix-955a` |
| Head SHA | `a93c4a8cddfbd425ae4d51dffd9d7e156c545804` |
| Recommended gate | **HOLD G3 at FAIL**. Do not claim G3, G6, CERTIFIED, or `V1_INTEGRATION_PASS`. Independent SF-M03-INT rerun is a later agent. |
| CERTIFIED | **false** |

## Production / contracts (untouched)

No edits under `services/cmp-001-catalogue/src/**`. No migrations, grants, `reject_mutation()`, `enforce_offering_version_pin()`, RLS policies, frozen contracts, coverage/security gates, lockfile, or host composition.

## Defect

`asTenant()` opens one PostgreSQL transaction (`BEGIN` … `COMMIT`). Sequence before this fix:

1. `UPDATE offering_version` correctly rejected with `42501`.
2. PostgreSQL marked that transaction aborted.
3. Vitest caught the expected rejection; the transaction remained failed.
4. Pin-guard `INSERT` in the same aborted transaction returned `25P02` (`current transaction is aborted`) before the pin-guard path could be evaluated.

## Test structure after fix

File: `services/cmp-001-catalogue/test/integration/privilege-boundary.int.test.ts`

- Transaction A: create offering/version (after committed category/service seed) and **COMMIT**.
- Transaction B: immutable `UPDATE`; assert **`42501`**; `asTenant` rolls back.
- Transaction C: `INSERT` with `published_pin_ref` and no privileged marker; independently assert **`42501`**; rolls back.

Assertions were not weakened. `25P02` is not swallowed.

## Executed run

| Item | Value |
|---|---|
| Command | `pnpm --filter @serviceform/cmp-001-catalogue run test:integration` |
| `DATABASE_URL` | disposable local PostgreSQL 16.15 (`serviceform_test`; credentials not recorded) |
| Result | **3 files, 8 tests passed, 0 failed** |
| Duration | 3.58s (Vitest 5.0.3) |
| JUnit | `evidence/CMP-001-INT-TX-FIX/junit-integration.xml` |
| Log | `evidence/CMP-001-INT-TX-FIX/vitest.log` |

Privilege case `refuses mutation of insert-only offering versions and unpublished pin without marker`: **pass**.

SQLSTATE outcomes for that case (independent transactions):

| Step | Statement | Expected | Observed |
|---|---|---|---|
| B | `UPDATE sf_catalogue.offering_version` | `42501` | `42501` (Vitest `rejects.toMatchObject`) |
| C | `INSERT` with `published_pin_ref`, no privileged marker | `42501` | `42501` (Vitest `rejects.toMatchObject`) |
| C | aborted-transaction `25P02` | must not appear | did not appear (would fail the `42501` assertion) |

Hard stop was not triggered: fresh-transaction pin-guard `INSERT` returned `42501`. Not a candidate production defect from this run.

## Explicit non-claims

- Not CERTIFIED, not G3, not G6.
- SF-M03-SEC / SF-M03-EVD not started.
- `V1_INTEGRATION_PASS` reserved for the independent INT verifier after this lands.
