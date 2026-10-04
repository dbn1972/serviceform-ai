#!/usr/bin/env bash
# Execute M01 Wave 1 + Wave 2 envelope / INT suites on pinned CI infra.
# Failures must fail the caller (no continue-on-error). Emits machine-readable
# artifacts under test-results/m01-envelope-int/ with SHA/run/job metadata.
#
# Covers all M01 W1+W2 components:
#   CMP-002, CMP-003, CMP-030, CMP-031, CMP-032, CMP-036, CMP-037, CMP-038,
#   CMP-047, CMP-048, CMP-055 (+ OPA + CDC + host composition + INT-013 markers).
#
# Each component INT suite runs once (full package). Re-running the same *.int
# files leaves residual rows (e.g. CMP-037 connector_binding_enabled_uniq).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

OUT_ROOT="${M01_INT_OUT:-${ROOT}/test-results/m01-envelope-int}"
SHA="$(git rev-parse HEAD)"
RUN_ID="${GITHUB_RUN_ID:-local}"
JOB="${GITHUB_JOB:-m01-envelope-int}"
RUNNER="${RUNNER_NAME:-$(hostname -s 2>/dev/null || hostname)}"
TS_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CONTRACTS_DIR="${OUT_ROOT}/contracts"

export M01_COMMIT_SHA="$SHA"
export M01_INT_TS="$TS_UTC"
export M01_INT_OUT="$OUT_ROOT"
export GITHUB_SHA="${GITHUB_SHA:-$SHA}"
export KAFKA_HOME="${KAFKA_HOME:-/var/tmp/kafka/kafka_2.13-4.1.0}"
export SF_KAFKA_DEBUG="${SF_KAFKA_DEBUG:-1}"

mkdir -p "$OUT_ROOT" "$CONTRACTS_DIR"
rm -f "${OUT_ROOT}/.failed"

if [[ -d contracts ]]; then
  cp -a contracts/. "$CONTRACTS_DIR/"
fi

: "${DATABASE_URL:?DATABASE_URL is required for M01 envelope INT}"
# CMP-038 K3 broker outage/recovery requires an owned Kafka process (helper startKafkaAgain).
unset SF_KAFKA_BROKERS || true

if [[ ! -x "${KAFKA_HOME}/bin/kafka-server-start.sh" ]]; then
  echo "ERROR: Kafka 4.1.0 not found at KAFKA_HOME=${KAFKA_HOME}" >&2
  exit 1
fi
if ! command -v opa >/dev/null 2>&1; then
  echo "ERROR: opa binary not on PATH" >&2
  exit 1
fi

write_suite_meta() {
  local task="$1" component="$2" suite="$3" result="$4" started="$5" finished="$6" log_path="$7"
  local dir="${OUT_ROOT}/${task}"
  mkdir -p "$dir"
  cat >"${dir}/${suite}.meta.json" <<EOF
{
  "task_id": "${task}",
  "component_id": "${component}",
  "suite": "${suite}",
  "result": "${result}",
  "commit_sha": "${SHA}",
  "github_run_id": "${RUN_ID}",
  "github_job": "${JOB}",
  "runner": "${RUNNER}",
  "started_at": "${started}",
  "finished_at": "${finished}",
  "timestamp": "${TS_UTC}",
  "log": "${log_path#"${ROOT}/"}"
}
EOF
}

# Package-scoped vitest (cwd = package via pnpm --filter exec).
run_pkg_vitest() {
  local pkg="$1"
  local config="$2"
  local junit_path="$3"
  local log_path="$4"
  shift 4
  local -a extra=("$@")
  set +e
  pnpm --filter "${pkg}" exec vitest run \
    --root . \
    --config "${config}" \
    --reporter=default \
    --reporter=junit \
    --outputFile.junit="${junit_path}" \
    "${extra[@]}" 2>&1 | tee "${log_path}"
  local rc=${PIPESTATUS[0]}
  set -e
  return "$rc"
}

# Root vitest.config.ts path-based (CMP-036/047/055 and host; no package.json filter).
run_root_vitest() {
  local junit_path="$1"
  local log_path="$2"
  shift 2
  local -a paths=("$@")
  set +e
  pnpm exec vitest run \
    --config vitest.config.ts \
    --reporter=default \
    --reporter=junit \
    --outputFile.junit="${junit_path}" \
    "${paths[@]}" 2>&1 | tee "${log_path}"
  local rc=${PIPESTATUS[0]}
  set -e
  return "$rc"
}

run_suite() {
  local task="$1"
  local component="$2"
  local suite="$3"
  local pkg="$4"
  local config="${5:-vitest.integration.config.ts}"
  shift 5 || shift 4
  local dir="${OUT_ROOT}/${task}"
  mkdir -p "${dir}/junit"
  local started finished result rc=0
  local log_path="${dir}/${suite}.log"
  local junit_path="${dir}/junit/${suite}.xml"
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "==> ${task} ${component} suite=${suite} pkg=${pkg} config=${config}"
  if ! run_pkg_vitest "${pkg}" "${config}" "${junit_path}" "${log_path}" "$@"; then
    rc=1
  fi
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ "$rc" -eq 0 ]]; then
    result="PASS"
  else
    result="FAIL"
    echo "${task}:${suite}" >>"${OUT_ROOT}/.failed"
  fi
  write_suite_meta "$task" "$component" "$suite" "$result" "$started" "$finished" "$log_path"
  return 0
}

run_path_suite() {
  local task="$1"
  local component="$2"
  local suite="$3"
  shift 3
  local -a paths=("$@")
  local dir="${OUT_ROOT}/${task}"
  mkdir -p "${dir}/junit"
  local started finished result rc=0
  local log_path="${dir}/${suite}.log"
  local junit_path="${dir}/junit/${suite}.xml"
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "==> ${task} ${component} suite=${suite} paths=${paths[*]}"
  if ! run_root_vitest "${junit_path}" "${log_path}" "${paths[@]}"; then
    rc=1
  fi
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ "$rc" -eq 0 ]]; then
    result="PASS"
  else
    result="FAIL"
    echo "${task}:${suite}" >>"${OUT_ROOT}/.failed"
  fi
  write_suite_meta "$task" "$component" "$suite" "$result" "$started" "$finished" "$log_path"
  return 0
}

alias_log() {
  local task="$1" src="$2" dest="$3"
  cp -f "${OUT_ROOT}/${task}/${src}.log" "${OUT_ROOT}/${task}/${dest}.log"
}

# ---------------------------------------------------------------------------
# Wave 1 — SF-M01-001..005 (unchanged strength; fail-closed)
# ---------------------------------------------------------------------------
run_suite SF-M01-001 CMP-002 envelope-int @serviceform/cmp-002-tenant-organisation vitest.integration.config.ts
alias_log SF-M01-001 envelope-int privilege-boundary
alias_log SF-M01-001 envelope-int rls-negative
alias_log SF-M01-001 envelope-int failure-paths

run_suite SF-M01-002 CMP-048 envelope-int @serviceform/cmp-048-security-platform vitest.integration.config.ts
alias_log SF-M01-002 envelope-int privilege-boundary
alias_log SF-M01-002 envelope-int rls-negative
alias_log SF-M01-002 envelope-int opa-pep-fail-closed

{
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "${OUT_ROOT}/SF-M01-002"
  set +e
  pnpm --filter @serviceform/cmp-048-security-platform run opa:test 2>&1 \
    | tee "${OUT_ROOT}/SF-M01-002/opa-test-results.txt"
  rc=${PIPESTATUS[0]}
  set -e
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ "$rc" -eq 0 ]]; then result=PASS; else result=FAIL; echo "SF-M01-002:opa-test" >>"${OUT_ROOT}/.failed"; fi
  write_suite_meta SF-M01-002 CMP-048 opa-test "$result" "$started" "$finished" \
    "${OUT_ROOT}/SF-M01-002/opa-test-results.txt"
}

run_suite SF-M01-003 CMP-031 envelope-int @serviceform/cmp-031-audit-ledger vitest.integration.config.ts
alias_log SF-M01-003 envelope-int privilege-boundary
alias_log SF-M01-003 envelope-int failure-paths
alias_log SF-M01-003 envelope-int tamper-detection

run_suite SF-M01-004 CMP-038 envelope-int @serviceform/cmp-038-event-bus vitest.integration.config.ts
alias_log SF-M01-004 envelope-int privilege-boundary
alias_log SF-M01-004 envelope-int outbox-atomicity
alias_log SF-M01-004 envelope-int kafka-real-broker
alias_log SF-M01-004 envelope-int broker-outage

run_suite SF-M01-005 CMP-037 envelope-int @serviceform/cmp-037-integration-hub vitest.integration.config.ts
alias_log SF-M01-005 envelope-int privilege-boundary
alias_log SF-M01-005 envelope-int failure-paths
alias_log SF-M01-005 envelope-int duplicate-callback

# ---------------------------------------------------------------------------
# Wave 2 — CMP-003 / 030 / 032 / 036 / 047 / 055 (+ host + INT-013 markers)
# ---------------------------------------------------------------------------
run_suite SF-M01-W2-001 CMP-003 envelope-int @serviceform/cmp-003-jurisdiction vitest.integration.config.ts
alias_log SF-M01-W2-001 envelope-int privilege-boundary
alias_log SF-M01-W2-001 envelope-int rls-negative

run_suite SF-M01-W2-002 CMP-030 envelope-int @serviceform/cmp-030-consent-privacy vitest.integration.config.ts
alias_log SF-M01-W2-002 envelope-int privilege-boundary
alias_log SF-M01-W2-002 envelope-int rls-negative

run_suite SF-M01-W2-003 CMP-032 envelope-int @serviceform/cmp-032-storage vitest.integration.config.ts
alias_log SF-M01-W2-003 envelope-int privilege-boundary
alias_log SF-M01-W2-003 envelope-int rls-negative
alias_log SF-M01-W2-003 envelope-int int-013

# INT-013 simulation / mode-refusal markers (owned by CMP-032 + @serviceform/storage)
run_suite SF-M01-W2-003 CMP-032 int-013-cmp-032-unit @serviceform/cmp-032-storage vitest.unit.config.ts
run_suite SF-M01-W2-003 CMP-032 int-013-storage-unit @serviceform/storage vitest.config.ts

# CMP-036 / CMP-047: no PG *.int suites on main — host composition + edge/plugin units
run_path_suite SF-M01-W2-004 CMP-036 host-wave2-composition apps/api/test/composition.test.ts
run_path_suite SF-M01-W2-004 CMP-036 cmp-036-edge-unit services/cmp-036-api-gateway/test/edge.test.ts
run_path_suite SF-M01-W2-004 CMP-047 cmp-047-plugin-unit services/cmp-047-observability/test/plugin.test.ts

# CMP-055: no package.json on main — path-based vitest only (no product features)
run_path_suite SF-M01-W2-005 CMP-055 unit \
  services/cmp-055-developer-platform/test/agent-packaging.test.ts \
  services/cmp-055-developer-platform/test/openapi-pipeline.test.ts \
  services/cmp-055-developer-platform/test/provenance.test.ts

# F-V1-CDC: cross-component consumer-driven contracts (schema-driven; no cross-SQL)
{
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "${OUT_ROOT}/CDC/junit"
  set +e
  pnpm test:cdc 2>&1 | tee "${OUT_ROOT}/CDC/wave1-cdc.log"
  rc=${PIPESTATUS[0]}
  set -e
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ -f test-results/cdc/junit.xml ]]; then
    cp -f test-results/cdc/junit.xml "${OUT_ROOT}/CDC/junit/wave1-cdc.xml"
  fi
  if [[ "$rc" -eq 0 ]]; then result=PASS; else result=FAIL; echo "CDC:wave1-cdc" >>"${OUT_ROOT}/.failed"; fi
  write_suite_meta CDC CROSS-CMP wave1-cdc "$result" "$started" "$finished" \
    "${OUT_ROOT}/CDC/wave1-cdc.log"
}

python3 - <<'PY'
import json, os, pathlib, sys

root = pathlib.Path(os.environ["M01_INT_OUT"])
metas = sorted(root.glob("*/*.meta.json"))
suites = [json.loads(p.read_text(encoding="utf-8")) for p in metas]
failed = [s for s in suites if s.get("result") != "PASS"]
tasks = [
    "SF-M01-001",
    "SF-M01-002",
    "SF-M01-003",
    "SF-M01-004",
    "SF-M01-005",
    "SF-M01-W2-001",
    "SF-M01-W2-002",
    "SF-M01-W2-003",
    "SF-M01-W2-004",
    "SF-M01-W2-005",
]
components = [
    "CMP-002",
    "CMP-003",
    "CMP-030",
    "CMP-031",
    "CMP-032",
    "CMP-036",
    "CMP-037",
    "CMP-038",
    "CMP-047",
    "CMP-048",
    "CMP-055",
]
summary = {
    "schema": "serviceform.m01.envelope-int.summary.v1",
    "commit_sha": os.environ.get("M01_COMMIT_SHA") or (suites[0]["commit_sha"] if suites else ""),
    "github_run_id": os.environ.get("GITHUB_RUN_ID", "local"),
    "github_job": os.environ.get("GITHUB_JOB", "m01-envelope-int"),
    "timestamp": os.environ.get("M01_INT_TS", ""),
    "runner": os.environ.get("RUNNER_NAME", ""),
    "suite_count": len(suites),
    "pass_count": len(suites) - len(failed),
    "fail_count": len(failed),
    "result": "PASS" if suites and not failed else "FAIL",
    "suites": suites,
    "failed_suites": [f"{s['task_id']}:{s['suite']}" for s in failed],
    "tasks": tasks,
    "components": components,
    "covers": [
        "privilege-boundary-LOGIN",
        "RLS-negative",
        "OPA",
        "cross-component-SQL-denial",
        "Kafka-real-broker",
        "broker-outage-recovery",
        "outbox-atomicity",
        "inbox-idempotency",
        "retry-DLQ",
        "no-lost-committed-event",
        "failure-paths",
        "cross-component-CDC",
        "INT-011-W2-CMP-003-030-032",
        "INT-013-storage-simulation-markers",
        "host-wave2-composition",
        "CMP-036-edge",
        "CMP-047-plugin",
        "CMP-055-path-unit",
    ],
}
(root / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"result": summary["result"], "fail_count": summary["fail_count"], "failed": summary["failed_suites"], "suite_count": summary["suite_count"], "components": summary["components"]}, indent=2))
sys.exit(0 if summary["result"] == "PASS" else 1)
PY
