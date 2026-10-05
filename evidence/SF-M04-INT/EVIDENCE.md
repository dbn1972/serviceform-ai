# SF-M04-INT — independent V1 integration evidence

Independent verifier recommendation only: **`V1_INTEGRATION` + `_` + `PASS`**.  
**`CROSS_TENANT_LEAKAGE=0`**  
**Frozen contracts: 13/13 MATCH**  
**`production_base`** `afc8e253` + `d4c566a4a18b1e01d9b0a1163f9d6adf`  
**`production_code_modified=false`**

Not CERTIFIED. Not RELEASE CERTIFIED. Not G3. Not G6. EVD not started. M05 OFF. Draft PR only — do not merge.

| Field | Value |
|---|---|
| Task | SF-M04-INT |
| Verifier | Independent integration stitcher (not M04 builders / STITCH / SEC / EVD) |
| Production SoT | `afc8e253` + `d4c566a4a18b1e01d9b0a1163f9d6adf` (merge #78) |
| Immutable verifier head | GitHub PR HEAD after this squash (split in `COMMIT_SHA.txt`) |
| Verifier branch | `cursor/m04-int-verify-32e8` |
| Independent run id | `local-m04-int` / job `independent-m04-integration` |
| Command | `bash tests/integration/m04/run.sh` |
| Components | CMP-039, CMP-008, CMP-011, CMP-013, CMP-009, CMP-014 + M04 host (CMP-036 composition) |
| Integration IDs | INT-011, INT-013 (re-verify) |
| SF-M04-SEC | not consumed |
| Defects patched in production | none (Class A harness only on verifier paths) |

## Environment

PostgreSQL 16.15 local disposable `serviceform_test` (credentials not recorded). Node 22 / pnpm 10.28.0. `pnpm install --frozen-lockfile` PASS on production base.

## Executed suites

| Suite | Result | Tests |
|---|---|---|
| Frozen contracts lock | PASS | 13/13 MATCH |
| Independent unit (INT-011 host + INT-013 modes) | PASS | 7 |
| Host `apps/api/test/composition-m04.test.ts` | PASS | 10 |
| CMP-039 envelope int | PASS | 10 |
| CMP-008 envelope int | PASS | 14 |
| CMP-011 envelope int | PASS | 13 |
| CMP-013 envelope int | PASS | 11 |
| CMP-009 envelope int | PASS | 9 |
| CMP-014 envelope int | PASS | 4 |
| Independent int (RLS catalog + HTTP stitch) | PASS | 11 |
| CMP-039/008/011/013/009/014 unit (INT-013 re-verify) | PASS | 51+56+108+66+30+20 = 331 |
| **Totals** | **11/11 suites PASS** | **420 executed tests** (plus contracts lock) |

Machine summary: `summary.json`. Cross-tenant: `summary/cross-tenant.json` (`CROSS_TENANT_LEAKAGE=0`).

## Coverage asserted independently

- M04 host mounts six components together; CMP-036 registered once; M01/M02/M03 mount lists preserved when omitted/when registered
- Tenant context server-derived; forged `X-Tenant-ID` / `x-tenant-id` → `SF-TEN-002`; canary never echoed
- Wrong-tenant HTTP 404 / RLS hide; wrong-tenant INSERT `42501` in a **fresh** transaction after abort (no 25P02 false negative)
- Published/version-pinned GoRules; deterministic evaluation; OPA deny `SF-AUTH-002`
- Published/version-pinned forms; server-authoritative validation
- Evidence-policy publish/pin/resolve
- Upload → complete → scan → AVAILABLE; checksum pin; wrong-tenant document hide
- AI Gateway source ACL / purpose deny; output redaction of email; advisory-only
- Document Intelligence via CMP-039 `AiGatewayPort` only; low-confidence → `NEEDS_REVIEW`
- SIMULATED critical adapters fail-closed in PRODUCTION (INT-013)
- Malformed metadata/document fail closed
- Peer privilege / SET ROLE denied; idempotency replay

## Residuals (non-blocking; classified)

- **D** REAL/SANDBOX provider, OCR, storage, scanner, DigiLocker adapters are not shipped in M04; fail-closed in PRODUCTION is verified. Expected simulated limitation.
- **E** Envelope unit JUnit default paths under some component `evidence/` dirs are gitignored / not copied (outside this envelope). Independent copies live under `evidence/SF-M04-INT/`.
- GitHub `ci` / `security` / `developer-platform` on the immutable verifier head are recorded after this evidence commit (see PR). Local run does not substitute for those workflows.

## Explicit non-claims

- Not VERIFIED / Not CERTIFIED / Not G3_INTEGRATION_VERIFIED / Not G6
- Do not merge this PR to `main` from this evidence alone
- SEC / EVD remain independent; EVD remains OFF until both INT and SEC immutable PASS
- M05 remains OFF
