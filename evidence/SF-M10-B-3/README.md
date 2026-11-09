# SF-M10-B-3 — post-approval issuance + SIMULATED DigiLocker publish (SAMPLE_LAB)

| Field | Value |
|---|---|
| Task | Phase B slice B-3 (CCR-M10-003). Builder evidence only; independent verification still required |
| Branch | `cursor/m10-phase-b-3-digilocker-4d00` from `origin/main` @ `0bbac96` (not stacked on B-2c) |
| Code under test | `66ec832e0b278bedee46cece95591adc60f6a363` |
| Run | 9 Nov 2026, Cursor cloud VM. Node 22.23.4, PostgreSQL 16.15 (own cluster, port 5433, own database), OPA 1.21.1, Chromium (Playwright) |
| Model | claude-opus-5-5 (route `opus`, per MODEL-ROUTING-QUALITY.md); subagent `bc-56789181-95c3-5c2b-a3d5-f71b61253276` |
| Stamp | SAMPLE_LAB · **SIMULATED** eSign/render/DigiLocker · synthetic data only · **CERTIFIED=false · G6=false · self_certified=false** · no REAL DigiLocker |

## What is exercised

HUMAN officer APPROVE (CMP-015 `RECORD_APPROVED`, actor OFFICER) → host SYSTEM workload:
`ENTER_SIGNING_PENDING` → CMP-022 issue (SIMULATED render, INT-013 SIMULATED eSign, CMP-024
registration) → `RECORD_ISSUED` → CMP-012 SIMULATED publish → CMP-022 downstream outcome. Citizen
and officer portals show the credential id and DigiLocker `PUBLISHED (SIMULATED)`.

## Results

| Suite | Result | Evidence |
|---|---|---|
| Platform INT `tests/integration/m10-platform/issuance-digilocker.test.ts` (real PG + OPA, two tenants) | **6/6 passed** | `logs/m10-platform-int.log`, `junit/m10-platform-int.xml` |
| Platform INT, BFF seam approve → issue → publish (officer + citizen route handlers) | passed | same |
| Platform INT, whole suite | 57 passed, 2 expected-fail, **9 failed — identical set on `origin/main`** (see below) | same |
| Playwright `tests/e2e/platform-journey.spec.ts` (built portals, lab host) | **29/29 passed**, incl. approve → ISSUED → DigiLocker PUBLISHED (SIMULATED) with axe on the issued pages | `logs/e2e-platform-journey.log`, `junit/e2e-junit.xml` |
| Host + portal unit (`apps/api/test/issuance.test.ts`, `platform-lab.test.ts`, `apps/web-citizen/test/issuance-projection.test.ts`) | 32/32 passed | `logs/host-portal-unit.log` |
| Repository unit (`pnpm test`) | 323 files, 3116/3116 passed | `logs/unit-summary.log` |
| CMP-022 unit / PG integration | 145/145 · 10/10 | `logs/cmp-022-*`, `junit/cmp022-*` |
| CMP-024 unit / PG integration | 85/85 · 9/9 | `logs/cmp-024-*`, `junit/cmp024-*` |
| CMP-012 unit+contract / PG integration (incl. new list-by-credential) | 81/81 · 20/20 | `logs/cmp-012-*`, `junit/cmp012-*` |
| OPA `opa test policy/opa`, `opa check --strict` | 87/87, clean | `logs/opa-test.log` |
| Architecture gates `scripts/gates/run_all.py` | 10/10 | `logs/gates.log` |
| Typecheck + eslint (`apps/api`, `apps/web-citizen`, `apps/web-officer`) | clean | — |

### Pre-existing platform INT failures (not caused by B-3)

On clean `origin/main` @ `0bbac96` the platform INT suite cannot start: host B times out because
`support/tenant-b.mjs` restamps the PUBLISHED `form_version_id` pin, which the host refuses. B-3
fixes that. With only that one fix applied to `origin/main`, the same 9 tests fail as on this
branch: one `journey-state-machine` and one `int-005-posture` case expect policy revision `m10-b1`
(the bundle was already `m10-b2` on main); two more `int-005-posture` cases assert the pre-B-2c
Outbox-only advance posture; five `bff-seam` cases fail on citizen apply (422) and on
`CaseState` mapping assertions (`DEFICIENCY_RAISED` / `ACTION_REQUIRED`, plus one undefined
response). They are left for their owning slices (B-2c touches INT-005 posture) and are not marked
expected-fail here.

## Negative and safety checks covered

- PRODUCTION / UAT / SANDBOX refused: fixture parser, issuance routes, `buildPlatformLab`; CMP-012
  binding policy and CMP-022 signing-marker check refuse SIMULATED outside LOCAL/CI on their own.
- Only an OFFICER may request issuance, only after a recorded OFFICER approval (409 otherwise, no
  transitions written); a non-empty POST body (tenant/actor injection) is 400; no context is 401.
- Another citizen gets 403/404 on the projection; portal principals get 403 on direct M07 routes;
  tenant B cannot read or issue tenant A's case.
- Retried issuance writes no second credential, registry entry, publish record or transition.
- A publish failure keeps the ISSUED case and credential and is reported, not compensated.

## Reproduce

```bash
# own PostgreSQL cluster/database; admin URL in DATABASE_URL (not committed)
DATABASE_URL=postgres://<admin>@127.0.0.1:5433/<db> \
SF_INT_A_API_PORT=4310 SF_INT_A_OPA_PORT=8491 SF_INT_B_API_PORT=4311 SF_INT_B_OPA_PORT=8492 \
  bash tests/integration/m10-platform/run.sh

pnpm -r --filter "./apps/web-*" run build
SF_PLATFORM_LAB_PORT=4320 SF_OPA_PORT=8501 DATABASE_URL=... scripts/dev/platform-lab.sh up
SF_API_BASE_URL=http://127.0.0.1:4320 pnpm e2e tests/e2e/platform-journey.spec.ts
```

Recommendation only: this is builder evidence. Gate status is for independent integration,
security and human review to decide.
