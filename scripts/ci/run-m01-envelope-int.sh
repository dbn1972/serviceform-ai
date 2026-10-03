#!/usr/bin/env bash
# Execute M01 Wave 1 envelope integration suites on pinned CI infra.
# Failures must fail the caller (no continue-on-error). Emits machine-readable
# artifacts under test-results/m01-envelope-int/ with SHA/run/job metadata.
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

mkdir -p "$OUT_ROOT" "$CONTRACTS_DIR"
rm -f "${OUT_ROOT}/.failed"

if [[ -d contracts ]]; then
  cp -a contracts/. "$CONTRACTS_DIR/"
fi

: "${DATABASE_URL:?DATABASE_URL is required for M01 envelope INT}"
export KAFKA_HOME="${KAFKA_HOME:-/var/tmp/kafka/kafka_2.13-4.1.0}"
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

run_vitest() {
  local pkg="$1"
  local junit_path="$2"
  local log_path="$3"
  shift 3
  local -a extra=("$@")
  set +e
  pnpm --filter "${pkg}" exec vitest run \
    --root . \
    --config vitest.integration.config.ts \
    --reporter=default \
    --reporter=junit \
    --outputFile.junit="${junit_path}" \
    "${extra[@]}" 2>&1 | tee "${log_path}"
  local rc=${PIPESTATUS[0]}
  set -e
  return "$rc"
}

run_suite() {
  local task="$1"
  local component="$2"
  local suite="$3"
  local pkg="$4"
  shift 4
  local dir="${OUT_ROOT}/${task}"
  mkdir -p "${dir}/junit"
  local started finished result rc=0
  local log_path="${dir}/${suite}.log"
  local junit_path="${dir}/junit/${suite}.xml"
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "==> ${task} ${component} suite=${suite}"
  if ! run_vitest "${pkg}" "${junit_path}" "${log_path}" "$@"; then
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

# --- SF-M01-001 CMP-002: privilege-boundary LOGIN, RLS negative, SQL denial, failure paths ---
run_suite SF-M01-001 CMP-002 privilege-boundary @serviceform/cmp-002-tenant-organisation \
  test/integration/privilege-boundary.int.test.ts
run_suite SF-M01-001 CMP-002 rls-negative @serviceform/cmp-002-tenant-organisation \
  test/integration/rls-matrix.int.test.ts
run_suite SF-M01-001 CMP-002 failure-paths @serviceform/cmp-002-tenant-organisation \
  test/integration/api-negative.int.test.ts \
  test/integration/pool-reuse.int.test.ts \
  test/integration/migration.int.test.ts
run_suite SF-M01-001 CMP-002 envelope-int @serviceform/cmp-002-tenant-organisation

# --- SF-M01-002 CMP-048: privilege-boundary, RLS, OPA PEP fail-closed ---
run_suite SF-M01-002 CMP-048 privilege-boundary @serviceform/cmp-048-security-platform \
  test/integration/privilege-boundary.int.test.ts
run_suite SF-M01-002 CMP-048 rls-negative @serviceform/cmp-048-security-platform \
  test/integration/rls-negative.int.test.ts
run_suite SF-M01-002 CMP-048 opa-pep-fail-closed @serviceform/cmp-048-security-platform \
  test/integration/pep-opa.int.test.ts \
  test/integration/opa-bundle.int.test.ts
run_suite SF-M01-002 CMP-048 envelope-int @serviceform/cmp-048-security-platform

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

# --- SF-M01-003 CMP-031: privilege-boundary + tamper/failure paths ---
run_suite SF-M01-003 CMP-031 privilege-boundary @serviceform/cmp-031-audit-ledger \
  test/integration/privilege-boundary.int.test.ts
run_suite SF-M01-003 CMP-031 failure-paths @serviceform/cmp-031-audit-ledger \
  test/integration/api-tamper.int.test.ts
cp -f "${OUT_ROOT}/SF-M01-003/failure-paths.log" "${OUT_ROOT}/SF-M01-003/tamper-detection.log"
run_suite SF-M01-003 CMP-031 envelope-int @serviceform/cmp-031-audit-ledger

# --- SF-M01-004 CMP-038: Kafka K1–K5, outage, outbox, inbox/idempotency, retry/DLQ ---
run_suite SF-M01-004 CMP-038 privilege-boundary @serviceform/cmp-038-event-bus \
  test/integration/security/privilege-boundary.int.test.ts
run_suite SF-M01-004 CMP-038 outbox-atomicity @serviceform/cmp-038-event-bus \
  test/integration/outbox.int.test.ts \
  test/integration/security/producer-consumer.int.test.ts \
  test/integration/security/relay-faults.int.test.ts
run_suite SF-M01-004 CMP-038 kafka-real-broker @serviceform/cmp-038-event-bus \
  test/integration/kafka.int.test.ts
cp -f "${OUT_ROOT}/SF-M01-004/kafka-real-broker.log" "${OUT_ROOT}/SF-M01-004/broker-outage.log"
run_suite SF-M01-004 CMP-038 envelope-int @serviceform/cmp-038-event-bus

# --- SF-M01-005 CMP-037: privilege-boundary, failure paths, inbox/idempotency ---
run_suite SF-M01-005 CMP-037 privilege-boundary @serviceform/cmp-037-integration-hub \
  test/privilege.int.test.ts
cp -f "${OUT_ROOT}/SF-M01-005/privilege-boundary.log" "${OUT_ROOT}/SF-M01-005/duplicate-callback.log"
run_suite SF-M01-005 CMP-037 failure-paths @serviceform/cmp-037-integration-hub \
  test/pg.int.test.ts
run_suite SF-M01-005 CMP-037 envelope-int @serviceform/cmp-037-integration-hub

python3 - <<'PY'
import json, os, pathlib, sys

root = pathlib.Path(os.environ["M01_INT_OUT"])
metas = sorted(root.glob("*/*.meta.json"))
suites = [json.loads(p.read_text(encoding="utf-8")) for p in metas]
failed = [s for s in suites if s.get("result") != "PASS"]
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
    "tasks": ["SF-M01-001", "SF-M01-002", "SF-M01-003", "SF-M01-004", "SF-M01-005"],
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
    ],
}
(root / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"result": summary["result"], "fail_count": summary["fail_count"], "failed": summary["failed_suites"]}, indent=2))
sys.exit(0 if summary["result"] == "PASS" else 1)
PY
