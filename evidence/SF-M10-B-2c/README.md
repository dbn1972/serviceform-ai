# SF-M10-B-2c — CMP-016 Temporal sequencing on the SAMPLE_LAB platform host path

| Field | Value |
|---|---|
| Code commit | see PR head (branch `cursor/m10-phase-b-2c-temporal-4d00`, from `main` `fc70b19`); evidence collected at `7be961f` + lint fix |
| Run | Local, Cursor cloud VM, 9 Nov 2026. Node 22.23.4, PostgreSQL 16.15, OPA 1.21.1, Temporal CLI 1.5.0 (Server 1.29.0) dev server, Chromium headless shell 1243 |
| Builder | serviceform-case-execution-builder, route `opus`, model claude-opus-5-5. Builder evidence only; independent INT/SEC/EVD pending |
| Stamp | SAMPLE_LAB · LOCAL/CI only · connectors SIMULATED · CERTIFIED=false · G6=false · self_certified=false |

## What is wired

Order on every CMP-015 command (Constitution #10/#11): case change, transition row and
`ApplicationStateChanged` outbox row, then the CMP-015 commit, and only after that the post-commit
`WorkflowAdvancePort` → host `LabWorkflowBridge` → CMP-016 `WorkflowService.onCaseTransitionCommitted`
→ Temporal signal `sf.committedTransition`. The response says `SIGNALLED` / `temporal_advanced=true`
only when CMP-016 delivered the signal. Any CMP-016, OPA or Temporal failure is `DEFERRED_TO_OUTBOX`;
the committed outbox event stays the durable trigger.

- **CMP-015 (additive, host-facing):** `WorkflowAdvanceSignal` carries the `SF-CON-COMMAND-TRANSITION`
  record as of `DOMAIN_COMMITTED` and the committed outbox `event_id` (commit `1b1bece`). No FROZEN
  contract changed. The gate refuses to call the port before the commit receipt.
- **CMP-016 (additive SDK export):** `connectCanonicalWorker` (worker with its own native connection) and
  `TemporalSdkClient.close()`.
- **Host (`apps/api/src/platform/workflow.ts`, `runtime.ts`, `lab-server.ts`):** composes CMP-016
  `WorkflowService`, the Temporal client and the canonical worker in-process. CMP-016 has no HTTP surface.
  - Instance start: after the CMP-015 `CREATE_DRAFT` commit (never fails the draft), with a retry on the
    first transition if the instance is missing.
  - Readiness adds `cmp016-db` and `cmp016-temporal-worker`.
  - Activity ports the lab graph never reaches (human task, rule, activity, process, timer) fail closed.
- **Workflow version seed (LOCAL/CI only, SIMULATED):** `fixtures/lab/platform/workflow.json`
  - The canonical graph mirrors the CMP-015 ALWAYS_LEGAL transitions with WAIT nodes only.
  - It is published through the real CMP-016 path (validation, maker ≠ checker, immutability triggers,
    outbox, audit) on the TSB pin `0d15ba00-0012-4000-8000-0d15ba000012`.
  - The publication authorizer admits only the fixture author and approver. The approval port approves
    only the pinned version, the recorded `approval_ref` and the exact `graph_hash`.
  - It refuses outside LOCAL/CI. Studio → CMP-052 replaces it in B-4.
- **OPA (`m10-b2c`):** new PROTECTED actions `WORKFLOW_INSTANCE_START` and `WORKFLOW_SIGNAL_ADVANCE` on
  resource type `Application`. The SAMPLE_LAB role `SAMPLE_LAB_WORKFLOW_SEQUENCER` is held only by the
  worker workload identity (SYSTEM, `WORKLOAD_IDENTITY`). Rego tests cover the allow, the cross-tenant
  deny, no case or decision actions, and resource-type confinement.
- **Bootstrap:** `sf_lab_cmp016` login (ADR-0006: `sf_app` + `sf_cmp016_rw`, NOSUPERUSER, NOBYPASSRLS) →
  `DATABASE_URL_CMP016`. It also sets `SF_TEMPORAL_ADDRESS`, `SF_TEMPORAL_NAMESPACE` and `SF_TEMPORAL_TASK_QUEUE`.
- **`scripts/dev/platform-lab.sh`:** reuses a Temporal server already listening on `SF_TEMPORAL_PORT`.
  Otherwise it starts `temporal server start-dev` (in-memory, headless) from `TEMPORAL_BIN`, `temporal`
  on PATH, or the pinned Temporal CLI 1.5.0 release, downloaded and sha256-verified into
  `.platform-lab/bin`. CI's ui-smoke job needs no workflow change.

Officers still act only through CMP-015 commands (MARK_RECEIVED / RECORD_APPROVED / RECORD_REJECTED …);
Temporal follows. No LLM is on this path.

## Executed

| Check | Result | Log |
|---|---|---|
| `scripts/dev/platform-lab.sh up` on a fresh database (self-started Temporal) | up, readiness 5/5 | `logs/platform-lab-up.log` |
| `pnpm e2e` against that host | 69 passed | `logs/e2e.log` |
| Workflow rows after e2e: every case has a RUNNING instance whose active node equals its CMP-015 state; version PUBLISHED, maker ≠ checker; 0 deferred advances | 8/8 cases | `logs/e2e-workflow-rows.log` |
| `tests/integration/m10-platform/run.sh` (two hosts, two tenants, one Temporal) | INT-005 8/8; 58 passed, 2 expected-fail, **5 failed (pre-existing, see below)** | `logs/m10-platform-int.log`, `junit/m10-platform-int.xml` |
| apps/api vitest (incl. new `platform-lab-workflow.test.ts`, composition-m05 "no CMP-016 HTTP surface") | 15 files, 128+ tests passed | — |
| Root `pnpm test` | 321 files, 3107 tests passed | `logs/root-unit.log` |
| CMP-015 unit / integration (PostgreSQL) | 141/141, 31/31 | `logs/cmp015-unit.log`, `logs/cmp015-integration.log` |
| CMP-016 unit / typecheck | 136/136, clean | `logs/cmp016-unit.log`, `logs/cmp016-typecheck.log` |
| CMP-016 integration (PostgreSQL) | 20/21, **1 pre-existing failure** | `logs/cmp016-integration.log` |
| CMP-016 Temporal SDK suite (time-skipping server) | 11/12, **1 pre-existing failure** | `logs/cmp016-temporal.log` |
| `opa check --strict`, `opa fmt --fail`, `opa test` | 85/85 | `logs/opa.log` |
| Pinned Temporal CLI download: fetch + sha256 + cache; wrong checksum refused | pass | `logs/temporal-cli-download.log` |
| `python3 scripts/gates/run_all.py` | 10/10 | `logs/gates.log` |
| format, lint, workspace typecheck | pass | `logs/format-check.log`, `logs/lint.log`, `logs/typecheck.log` |

## INT-005 gap status

The **Temporal sequencing gap is closed** on the platform path. `int-005-posture.test.ts` no longer pins
the EXPECTED GAP, and the INT-F3 `it.fails` is gone (CMP-015 already reports `DEFERRED_TO_OUTBOX` when
nothing was signalled; the bridge unit tests assert that). The suite now asserts:

- `SIGNALLED` / `temporal_advanced=true` on all three commands
- one RUNNING `sf_workflow.workflow_instance` on the pinned PUBLISHED version
- active node `WAIT_RECEIVED`, and `last_signal_id` = the MARK_RECEIVED `command_id`
- CMP-016 inbox = exactly the CMP-015 `ApplicationStateChanged` event ids
- Temporal `describe` shows RUNNING `serviceformCanonicalWorkflow` with 3 signals in its history
- the env has a Temporal endpoint and the `sf_lab_cmp016` login
- an OPA-authorized officer action whose revision is read from the bundle
- a citizen cannot drive an officer command

**Still open in INT-005:** the workflow does not create a CMP-017 officer task. The lab graph has no
HUMAN_TASK nodes, and CMP-017 is not composed on this host. Officers see the queue through CMP-015 list.

## Pre-existing failures (not introduced here; no files in this slice touch them)

- **`bff-seam.test.ts`, 5 tests.** Drift against later `main` merges (`623b938` template catalogue, `9b71228` status
  mappings). The citizen apply route now needs a catalogue-scoped body (422 before CMP-015), and four
  status-mapping assertions or `it.fails` are stale. Owner: SF-M10-B-INT suite.
- **CMP-016 `db-isolation` and `sdk-worker` privilege negatives.** These fail because `sf_migration.*` and
  `sf_semantics.*` migrations on `main` grant `sf_app` SELECT on 11 tables and UPDATE on 2. The cross-schema
  negatives trip on those grants. No migration is changed in this slice.
- **Tenant B host start.** Before this slice, `tenant-b.mjs` rewrote the form pin to a version absent from the
  catalogue, so host B refused to start and `run.sh` could not run at all. Fixed here (the form pin stays on
  the PUBLISHED catalogue version), because the INT suite is in scope.

## Known limitations for the verifiers

- If the instance row commits but `temporal.start` fails, later signals return `DEFERRED_TO_OUTBOX` until
  the CMP-038 relay (not composed) re-drives them. The case itself is unaffected.
- The first `/health/ready` probe after start can get a 503 from `@fastify/under-pressure` while the worker
  bundle is built. The readiness wait retries, and the 503 body also fails the health response schema
  (pre-existing, `apps/api/src/plugins/health.ts`).
- Withdrawal and cancellation are not in the lab graph, so they would be rejected inside the workflow
  (logged; the case is unaffected). They remain DenyServicePolicyPort on this host anyway.
- Host B uses its own task queue (`sf-sample-lab-workflow-b`) on the shared Temporal server.
