# M01 Wave 1 independent verification gate record

**Decision: `M01_WAVE1_GATE_READY`**

All independent verifiers V1–V5 **PASS** on frozen candidate SHA below. **Not CERTIFIED.** Human/CI approval required before any merge. Do not merge PR #22 or PR #21 on this record alone. Do not start Wave 2. Production code and frozen contracts were not modified by this gate-record write.

| Field | Value |
|---|---|
| Module | M01 Wave 1 |
| Remediation branch | `cursor/m01-w1-remediation-r1` |
| Candidate PR | https://github.com/dbn1972/serviceform-ai/pull/22 |
| Verification candidate SHA (frozen) | `7a571ced96a233f9f233b7af730e4645dccbd1a4` |
| Historical baseline | PR #21 `d33601a5c2c332548530897df1bd35702317df44` (immutable; not developed on) |
| Tip ignored for code assessment | `379c9fb` (docs/handover bind only) |
| Overall gate | **`M01_WAVE1_GATE_READY`** |
| Self-certified | **false** |
| CERTIFIED | **false** (`not_certified: true`) |
| Wave 2 started | **false** |

## Verifier agents (re-verification r1)

| Gate | Agent | Result | Source report |
|---|---|---|---|
| V1 Integration | `bc-412ee224-476d-5925-b9c2-8e561d947f5f` | `V1_INTEGRATION_PASS` | `/cursor/stores/bc-1e78e82c-97d0-4244-ab49-3bcc7891e193/internal/verification/r1-v1-integration.md` |
| V2 Security | `bc-e22725da-8ddc-5e09-a250-d0ad5550a6c0` | `V2_SECURITY_PASS` | `/cursor/stores/bc-1e78e82c-97d0-4244-ab49-3bcc7891e193/internal/verification/r1-v2-security.md` |
| V3 Architecture | `bc-4bb27dc4-7f9f-50eb-b859-b584ec608c49` | `V3_ARCHITECTURE_PASS` | `/cursor/stores/bc-1e78e82c-97d0-4244-ab49-3bcc7891e193/internal/verification/r1-v3-architecture.md` |
| V4 Quality | `bc-920d9e99-e22a-53e3-bc3b-b4288efac866` | `V4_QUALITY_PASS` | `/cursor/stores/bc-1e78e82c-97d0-4244-ab49-3bcc7891e193/internal/verification/r1-v4-quality.md` |
| V5 Evidence | `bc-e70b491e-f9d4-50fb-ba57-7b9dd23f9c79` | `V5_EVIDENCE_PASS` | `/cursor/stores/bc-1e78e82c-97d0-4244-ab49-3bcc7891e193/internal/verification/r1-v5-evidence.md` |

## Executed evidence (bound to frozen SHA)

| Evidence | Value |
|---|---|
| GitHub ci | [37163807120](https://github.com/dbn1972/serviceform-ai/actions/runs/37163807120) **SUCCESS** (`headSha=7a571ce…`; 7/7 jobs incl. M01 envelope integration) |
| GitHub security | [37163807119](https://github.com/dbn1972/serviceform-ai/actions/runs/37163807119) **SUCCESS** (`headSha=7a571ce…`; 5/5 jobs) |
| Independent INT (V1) | **7/7 PASS** (CMP-002, CMP-048 INT + opa:test, CMP-031, CMP-038, CMP-037, Wave 1 CDC) |
| Cross-tenant leakage (V2) | **`CROSS_TENANT_LEAKAGE=0`** |
| Frozen contract hashes (V3) | **13/13 MATCH** (`contracts_lock_gate.py` PASS; no CCR) |
| Coverage (V4 / GitHub quality) | Statements **92.19%** / Functions **93.97%** / Lines **94.22%** / Branches **82.91%** (thresholds held; VTQS 95.0) |
| Envelope artifact | `m01-envelope-int-d270a4fc51ca317062d14127a53bba419e87b341` — `ARTIFACT-INDEX.json` `commit_sha=7a571ce…`, `github_run_id=37163807120` |

### V5 documented limitation

Suite-level `*.meta.json` / `summary.json` stamp `commit_sha=d270a4fc…` (ephemeral GitHub `pull_request` merge ref of `7a571ce` into `main`). Authoritative bind remains `ARTIFACT-INDEX.json` + workflow `headSha` = `7a571ced96a233f9f233b7af730e4645dccbd1a4`. Accepted as **GATE_READY_WITH_DOCUMENTED_LIMITATION** for evidence role; does not fail V5 or overall gate readiness.

## Gate decisions

| Gate | Decision |
|---|---|
| V1 Integration | PASS |
| V2 Security | PASS |
| V3 Architecture | PASS |
| V4 Quality | PASS |
| V5 Evidence | PASS (documented limitation above) |
| **Aggregate** | **`M01_WAVE1_GATE_READY`** |

Machine-readable companion: `orchestrator/handovers/M01-WAVE1-GATE.yaml` (`gate_ready: true`, `self_certified: false`, `not_certified: true`).

## Residuals (non-blocking; not cleared by this record)

1. **ADR-0006 #9 / SF-CON-OUTBOX:** `GRANT INSERT` (and inbox `SELECT, INSERT`) **TO `sf_app`** remains frozen-template behavior. Tightening requires a Contract Change Request. Not CROSS_TENANT_LEAKAGE; R8 closed owner=`sf_migrator` without altering grants.
2. **Not CERTIFIED** — independent verifiers and this gate record do not certify module/release exit.
3. **Human approval required** before merge of PR #22 (or any Wave 1 candidate).
4. **No Wave 2** — host composition (`apps/api` / CMP-036) and later modules remain out of scope.
5. Quality hygiene residuals (e.g. dual `@fastify/rate-limit` majors) remain non-blocking for V4.

## Constraints observed by this record

- Did not change production code, tests, CI workflows, or frozen contracts
- Did not rewrite frozen SHA `7a571ce`
- Did not merge PR #22 or PR #21
- Did not start Wave 2
- Did not self-certify (`self_certified: false`)

## Store mirror

Same content mirrored at:

`/cursor/stores/bc-1e78e82c-97d0-4244-ab49-3bcc7891e193/docs/m01-wave1-independent-verification.md`
