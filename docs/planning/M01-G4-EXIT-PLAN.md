# M01 G4 exit plan (PLANNING ONLY)

**Decision token: `M01_G4_EXIT_PLAN_READY`**

| Field | Value |
|---|---|
| Module | M01 Foundation, Tenancy, Jurisdiction, Security and Platform Backbone |
| Exit gate (`specs/build-plan.yaml`) | `G4_SECURITY_VERIFIED` |
| Exit record token (target) | `M01_COMPLETE_G4_SECURITY_VERIFIED` |
| Planning baseline | `origin/main` @ `8bc7a1a50ee8aa622fd5a6a2866f50b065a79d76` |
| Wave 1 | `M01_WAVE1_MERGED_AND_CLOSED` (merge `37cbf203e18d8e072353139e368356a8dac00946`) |
| Wave 2 | Gate-combine merged via PR #33 (merge `8bc7a1a50ee8aa622fd5a6a2866f50b065a79d76`) |
| M01 components | CMP-002, CMP-003, CMP-030, CMP-031, CMP-032, CMP-036, CMP-037, CMP-038, CMP-047, CMP-048, CMP-055 (all on main) |
| M01 Wave 3 feature wave | **None** (build-plan has no Wave 3 coding wave for M01) |
| CERTIFIED / RELEASE CERTIFIED | **false** (out of scope; not G6) |
| `implementation_authorized` | **false** |
| M02 / M03 / CG-01 | **Blocked** until exit token issued by human/CI |
| Frozen contracts altered | **none** |
| Self-certified | **false** |

## 1. Governance sequence (normative)

1. Architecture Constitution (immutable constraints)
2. Frozen shared contracts (`orchestrator/contracts-lock.yaml`, 13/13 MATCH)
3. Confirmed sequencing: W1+W2 merged; no M01 Wave 3 feature coding; CG-01 (M02∥M03) only after M01 G4 exit
4. Bounded G4 exit envelopes (`orchestrator/handovers/SF-M01-G4-00x.yaml`) — **PLANNING** only
5. **Later, only if a human authorizes exit implementation:** isolated parallel exit envelopes
6. Independent evidence bind
7. Human / CI issues `M01_COMPLETE_G4_SECURITY_VERIFIED` (still **not** RELEASE CERTIFIED)
8. Only then dispatch CG-01: M02 ∥ M03

This planning pass stops at step 4.

## 2. Authoritative inputs

| Input | Role |
|---|---|
| `00_READ_FIRST.md`, `ARCHITECTURE-CONSTITUTION.md`, `AGENTS.md` | Absolute constraints |
| `MULTI-AGENT-DEVELOPMENT.md`, `CLAUDE-MULTI-AGENT-GUIDE.md` | Envelope / parallel rules |
| `specs/build-plan.yaml` (ADR-0001) | M01 component set; `exit_gate: G4_SECURITY_VERIFIED`; CG-01 |
| `specs/agent-orchestration.yaml` | CG-01 after M01; merge policy |
| `specs/integration-map.yaml` | INT-011, INT-013 owned by M01 |
| Wave 1 handovers / closure | `orchestrator/handovers/M01-WAVE1-GATE.yaml`, `docs/verification/M01-WAVE1-CLOSURE.md` |
| Wave 2 plan / stitch / INT / SEC evidence | `orchestrator/handovers/M01-WAVE2-PLAN.yaml`, `evidence/SF-M01-W2-*` |
| CI envelope-int | `.github/workflows/ci.yml` job `m01-envelope-int`; `scripts/ci/run-m01-envelope-int.sh` |
| Residual R-ENV-INT | `evidence/SF-M01-W2-STITCH/RESIDUALS.md` |

## 3. Baseline already on `main` (do not rebuild features)

| Wave | CMPs | Status |
|---|---|---|
| Wave 1 | CMP-002, CMP-048, CMP-031, CMP-038, CMP-037 | Merged / closed |
| Wave 2 | CMP-003, CMP-030, CMP-032, CMP-036, CMP-047, CMP-055 | Merged via #33 |

Union = all 11 M01 CMPs. Independent W2 V1–V5 were PASS on stitch candidate `347fe74` (ancestor of main). Module exit still requires G4 scopes below on **current main**.

## 4. Five exit scopes (exact; no feature CMPs)

### 4.1 Fix R-ENV-INT — SF-M01-G4-001

**Current defect:** GitHub job name/tasks remain `SF-M01-001..005` only; script `scripts/ci/run-m01-envelope-int.sh` runs W1 packages only.

**Required:**

- Generalize job + script beyond SF-M01-001..005
- Execute all M01 W1+W2 components with INT/envelope suites
- Keep fail-closed (no `continue-on-error`); do not weaken W1 coverage
- `ARTIFACT-INDEX.json` / suite meta bind **current main SHA** (PR head on PRs)
- Update job name + `tasks` array to reflect full M01 coverage

**Add W2 inventory:**

| CMP | How to run (planning) |
|---|---|
| CMP-003 | `@serviceform/cmp-003-jurisdiction` vitest integration |
| CMP-030 | `@serviceform/cmp-030-consent-privacy` vitest integration |
| CMP-032 | `@serviceform/cmp-032-storage` + storage INT-013 marker suites |
| CMP-036 / CMP-047 | Host composition (`@serviceform/api`) + gateway/obs suites used by W2 INT |
| CMP-055 | Path-based vitest under `services/cmp-055-developer-platform/test` — **no `package.json` on main**; no new product features; packaging-only fix allowed if required for CI filter |

### 4.2 Complete M01 regression on main — SF-M01-G4-002

After generalized envelope-int is on the tip under test:

- Full CMP list (all 11)
- RLS / tenant / OPA / privilege-boundary
- Hub SIMULATED + storage SIMULATED (INT-013)
- Host composition (W1+W2 mounts)
- Audit / outbox / inbox
- GitHub `ci` + `security` SUCCESS; SAST; deps graph

Evidence binds exact SHA. Not CERTIFIED.

### 4.3 Final security exit — SF-M01-G4-003

Independent security verifier (opus xhigh). Hard gates:

- `CROSS_TENANT_LEAKAGE=0`
- No `SUPERUSER` / `BYPASSRLS` on runtime roles
- `FORCE RLS` on tenant-scoped tables
- No raw `X-Tenant-ID` trust (edge forgery denied)
- No cross-component SQL
- No PII / secrets in observability samples
- Frozen contracts still 13/13 MATCH

### 4.4 Close or formally carry residuals — SF-M01-G4-004

| Residual | Exit disposition |
|---|---|
| R-ENV-INT | **Fix now** (G4-001); close when evidence proves generalized job on main SHA |
| ADR-0006 #9 outbox `sf_app` grants | **Accept residual** with explicit record language **OR** open CCR — **never** silent frozen-contract change |
| V5 / evidence provenance | Formalize headSha vs merge-ref bind rule for exit evidence |
| Branch protection / required checks | Confirm `ci` + `security` (incl. generalized envelope-int) required before M02/M03; document gaps |

Carry (explicit, non-silent): REAL S3/KMS/WAF; DPDP statutory anchors; R-COV global excludes — unchanged deferrals.

### 4.5 Exit record token — SF-M01-G4-005

Target token: **`M01_COMPLETE_G4_SECURITY_VERIFIED`**

Must record:

- Wave1 + Wave2 closed
- All M01 CMPs merged
- V1–V5 PASS on exit candidate
- `CROSS_TENANT_LEAKAGE=0`
- Frozen 13/13
- Residuals explicit
- **`certified: false` / not RELEASE CERTIFIED / not G6**

Human/CI issues the token. Evidence agent recommends only.

## 5. Parallelization map

```text
        [human authorizes M01 G4 exit implementation]
                         |
         +---------------+---------------+
         |                               |
   SF-M01-G4-001                    SF-M01-G4-004
   R-ENV-INT fix                    residuals disposition
         |                               |
         +--------+--------+             |
                  |                      |
           SF-M01-G4-002            SF-M01-G4-003
           full regression          security exit
                  |                      |
                  +----------+-----------+
                             |
                      SF-M01-G4-005
                      exit record (recommend)
                             |
              [human/CI issues M01_COMPLETE_G4_SECURITY_VERIFIED]
                             |
                      CG-01: M02 ∥ M03 unblocked
```

## 6. Non-overlapping write paths

| Envelope | Allowed write paths |
|---|---|
| SF-M01-G4-001 | `.github/workflows/ci.yml` (envelope-int generalize only), `scripts/ci/run-m01-envelope-int.sh`, `evidence/SF-M01-G4-001/**`, `orchestrator/handovers/SF-M01-G4-001.yaml` |
| SF-M01-G4-002 | `scripts/ci/run-m01-g4-regression.sh`, `tests/integration/m01-g4/**`, `evidence/SF-M01-G4-002/**`, `orchestrator/handovers/SF-M01-G4-002.yaml` |
| SF-M01-G4-003 | `tests/security/**`, `evidence/SF-M01-G4-003/**`, `orchestrator/handovers/SF-M01-G4-003.yaml` |
| SF-M01-G4-004 | `docs/verification/M01-G4-RESIDUALS.md`, `evidence/SF-M01-G4-004/**`, `orchestrator/handovers/SF-M01-G4-004.yaml`; CCR draft paths only if filing CCR |
| SF-M01-G4-005 | `docs/verification/M01-G4-EXIT.md`, `orchestrator/handovers/M01-G4-EXIT-GATE.yaml`, `orchestrator/handovers/SF-M01-G4-005.yaml`, `evidence/SF-M01-G4-005/**` |

**Shared forbidden:** `contracts/**`, `orchestrator/contracts-lock.yaml`, M02/M03 trees, feature CMP product expansions, CERTIFIED claims, gate weakening.

## 7. Verification matrix

| ID | Check | Envelope | Pass |
|---|---|---|---|
| VM-01 | Envelope-int covers W1+W2 | G4-001 | Job/script/tasks include W2; fail-closed |
| VM-02 | Envelope-int SHA bind | G4-001 | Artifact `commit_sha` = tip under test |
| VM-03 | All 11 CMPs regression | G4-002 | Executed; fail_count=0 |
| VM-04 | RLS/tenant/OPA/privilege | G4-002 + G4-003 | PASS; leakage=0 |
| VM-05 | Hub sim + storage sim + host | G4-002 | PASS |
| VM-06 | Audit/outbox/inbox | G4-002 | PASS |
| VM-07 | GitHub ci + security | G4-002 | SUCCESS on bound SHA |
| VM-08 | SAST / deps | G4-002 / G4-003 | Existing gates green |
| VM-09 | CROSS_TENANT_LEAKAGE | G4-003 | **0** |
| VM-10 | No SUPERUSER/BYPASSRLS; FORCE RLS | G4-003 | PASS |
| VM-11 | No raw X-Tenant-ID trust | G4-003 | Forgery denied |
| VM-12 | No cross-component SQL | G4-003 | Deny PASS |
| VM-13 | No PII/secrets in observability | G4-003 | PASS |
| VM-14 | Frozen 13/13 | G4-003 + G4-005 | MATCH |
| VM-15 | Residuals explicit | G4-004 | R-ENV-INT closed; ADR-0006 accept-or-CCR; provenance + protection |
| VM-16 | Exit token preconditions | G4-005 | Checklist complete; not RELEASE CERTIFIED |

## 8. Explicit gate: M02 + M03 blocked

Until **`M01_COMPLETE_G4_SECURITY_VERIFIED`** is issued by human/CI:

- Do not dispatch CG-01
- Do not mark M02/M03 envelopes READY for implementation
- Do not start Identity or Catalogue/Studio/UX4G builders

`specs/build-plan.yaml`:

```yaml
- {id: CG-01, after: [M01], parallel_modules: [M02, M03]}
```

`after: [M01]` means M01 exit gate satisfied — not merely Wave 2 merge.

## 9. Blockers / CCR / ADR inventory

| ID | Item | Blocks planning? | Action |
|---|---|---|---|
| R-ENV-INT | W1-only envelope-int | No | Fix in G4-001 |
| ADR-0006-9 | Outbox `sf_app` grants | No | Accept residual **or** CCR (never silent edit) |
| CMP-055-PKG | Missing `package.json` | No | Path-based INT or minimal packaging under exit scope |
| BRANCH-PROT | Required checks before M02/M03 | No | Document + human configure |
| AUTH-EXIT | Human auth for exit implementation | Blocks implementation | Flip `implementation_authorized` only when approved |

**No blocking CCR/ADR required to accept this plan.**

## 10. Explicit non-goals

- No M01 Wave 3 feature implementation
- No M02 / M03 / CG-01 work
- No frozen-contract edits
- No CERTIFIED / RELEASE CERTIFIED / G6 claim
- No REAL infra or statutory invention

## 11. Envelope index

| File | State |
|---|---|
| `orchestrator/handovers/M01-G4-EXIT.yaml` | PLANNING index |
| `orchestrator/handovers/SF-M01-G4-001.yaml` | PLANNING |
| `orchestrator/handovers/SF-M01-G4-002.yaml` | PLANNING |
| `orchestrator/handovers/SF-M01-G4-003.yaml` | PLANNING |
| `orchestrator/handovers/SF-M01-G4-004.yaml` | PLANNING |
| `orchestrator/handovers/SF-M01-G4-005.yaml` | PLANNING |

## 12. Confirmation

- Planning only: **yes**
- Implementation started: **no**
- M01 G4 exit started: **no**
- Frozen contracts altered: **no**
- CERTIFIED claimed: **no**
- M02/M03 started: **no**

Store mirrors:

- `/cursor/stores/bc-1e78e82c-97d0-4244-ab49-3bcc7891e193/docs/m01-g4-exit-plan.md`
- `/cursor/stores/bc-1e78e82c-97d0-4244-ab49-3bcc7891e193/docs/m01-g4-exit-envelopes.md`
