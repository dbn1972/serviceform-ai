#!/usr/bin/env bash
# Independent SF-M02-INT runner. Does not patch component production code.
# Not CERTIFIED. Failures fail the caller (no continue-on-error waiver).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

OUT_ROOT="${M02_INT_OUT:-${ROOT}/evidence/SF-M02-INT}"
SHA="$(git rev-parse HEAD)"
RUN_ID="${GITHUB_RUN_ID:-local-m02-int}"
JOB="${GITHUB_JOB:-independent-m02-integration}"
RUNNER="${RUNNER_NAME:-$(hostname -s 2>/dev/null || hostname)}"
TS_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

export M02_COMMIT_SHA="$SHA"
export M02_INT_TS="$TS_UTC"
export M02_INT_OUT="$OUT_ROOT"
export GITHUB_SHA="${GITHUB_SHA:-$SHA}"

mkdir -p "$OUT_ROOT" "${OUT_ROOT}/junit" "${OUT_ROOT}/logs" test-results/m02-int/junit
rm -f "${OUT_ROOT}/.failed" test-results/m02-int/cross-tenant.json

: "${DATABASE_URL:?DATABASE_URL is required for M02 INT}"

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

record() {
  local task="$1" component="$2" suite="$3" rc="$4" started="$5" finished="$6" log_path="$7"
  local result=FAIL
  if [[ "$rc" -eq 0 ]]; then result=PASS; else echo "${task}:${suite}" >>"${OUT_ROOT}/.failed"; fi
  write_suite_meta "$task" "$component" "$suite" "$result" "$started" "$finished" "$log_path"
}

run_pkg_int() {
  local task="$1" component="$2" pkg="$3"
  local dir="${OUT_ROOT}/${task}"
  mkdir -p "${dir}/junit"
  local started finished rc=0
  local log_path="${dir}/envelope-int.log"
  local junit_path="${dir}/junit/envelope-int.xml"
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "==> ${task} ${component} ${pkg} test:integration"
  set +e
  pnpm --filter "${pkg}" run test:integration -- \
    --reporter=default --reporter=junit --outputFile.junit="${junit_path}" \
    2>&1 | tee "${log_path}"
  rc=${PIPESTATUS[0]}
  set -e
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  record "$task" "$component" envelope-int "$rc" "$started" "$finished" "$log_path"
}

run_path() {
  local task="$1" component="$2" suite="$3"
  shift 3
  local dir="${OUT_ROOT}/${task}"
  mkdir -p "${dir}/junit"
  local started finished rc=0
  local log_path="${dir}/${suite}.log"
  local junit_path="${dir}/junit/${suite}.xml"
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "==> ${task} ${component} ${suite}"
  set +e
  pnpm exec vitest run --config vitest.config.ts \
    --reporter=default --reporter=junit --outputFile.junit="${junit_path}" \
    "$@" 2>&1 | tee "${log_path}"
  rc=${PIPESTATUS[0]}
  set -e
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  record "$task" "$component" "$suite" "$rc" "$started" "$finished" "$log_path"
}

{
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  set +e
  python3 scripts/gates/contracts_lock_gate.py 2>&1 | tee "${OUT_ROOT}/logs/contracts-lock.log"
  rc=${PIPESTATUS[0]}
  set -e
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  record LOCK FROZEN contracts-lock "$rc" "$started" "$finished" "${OUT_ROOT}/logs/contracts-lock.log"
}

{
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  set +e
  pnpm exec vitest run --config tests/integration/m02/vitest.config.ts \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/junit/independent-unit.xml" \
    2>&1 | tee "${OUT_ROOT}/logs/independent-unit.log"
  rc=${PIPESTATUS[0]}
  set -e
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  record SF-M02-INT INDEPENDENT independent-unit "$rc" "$started" "$finished" "${OUT_ROOT}/logs/independent-unit.log"
}

run_path SF-M02-003 CMP-036 host-composition-m02 apps/api/test/composition-m02.test.ts
run_pkg_int SF-M02-001 CMP-004 @serviceform/cmp-004-identity-access
run_pkg_int SF-M02-002 CMP-005 @serviceform/cmp-005-citizen-profile

{
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  set +e
  pnpm exec vitest run --config tests/integration/m02/vitest.int.config.ts \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/junit/independent-int.xml" \
    2>&1 | tee "${OUT_ROOT}/logs/independent-int.log"
  rc=${PIPESTATUS[0]}
  set -e
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  record SF-M02-INT INDEPENDENT independent-int "$rc" "$started" "$finished" "${OUT_ROOT}/logs/independent-int.log"
}

{
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "${OUT_ROOT}/INT-013/junit"
  set +e
  pnpm --filter @serviceform/cmp-004-identity-access run test:unit -- \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/INT-013/junit/cmp-004-unit.xml" \
    2>&1 | tee "${OUT_ROOT}/INT-013/cmp-004-unit.log"
  rc004=${PIPESTATUS[0]}
  pnpm --filter @serviceform/cmp-005-citizen-profile run test:unit -- \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/INT-013/junit/cmp-005-unit.xml" \
    2>&1 | tee "${OUT_ROOT}/INT-013/cmp-005-unit.log"
  rc005=${PIPESTATUS[0]}
  set -e
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  rc=0
  if [[ "$rc004" -ne 0 || "$rc005" -ne 0 ]]; then rc=1; fi
  record INT-013 MODES component-unit "$rc" "$started" "$finished" "${OUT_ROOT}/INT-013/cmp-004-unit.log"
}

python3 - <<'PY'
import json, os, pathlib, sys

root = pathlib.Path(os.environ["M02_INT_OUT"])
metas = sorted(root.glob("*/*.meta.json"))
suites = [json.loads(p.read_text(encoding="utf-8")) for p in metas]
failed = [s for s in suites if s.get("result") != "PASS"]
leak_path = pathlib.Path("test-results/m02-int/cross-tenant.json")
leakage = None
if leak_path.is_file():
    leakage = json.loads(leak_path.read_text(encoding="utf-8")).get("CROSS_TENANT_LEAKAGE")
if leakage is None:
    leakage = int(os.environ.get("CROSS_TENANT_LEAKAGE", "0") or "0")
hard_fail = failed or leakage != 0
summary = {
    "schema": "serviceform.m02.independent-int.summary.v1",
    "task_id": "SF-M02-INT",
    "commit_sha": os.environ.get("M02_COMMIT_SHA", ""),
    "github_run_id": os.environ.get("GITHUB_RUN_ID", "local-m02-int"),
    "github_job": os.environ.get("GITHUB_JOB", "independent-m02-integration"),
    "timestamp": os.environ.get("M02_INT_TS", ""),
    "runner": os.environ.get("RUNNER_NAME", ""),
    "suite_count": len(suites),
    "pass_count": len(suites) - len(failed),
    "fail_count": len(failed),
    "CROSS_TENANT_LEAKAGE": leakage,
    "result": "PASS" if suites and not hard_fail else "FAIL",
    "recommended_gate": "V1_INTEGRATION_PASS" if suites and not hard_fail else "V1_INTEGRATION_FAIL",
    "certified": False,
    "g3_integration_verified_claimed": False,
    "suites": suites,
    "failed_suites": [f"{s['task_id']}:{s['suite']}" for s in failed],
    "covers": [
        "INT-001-http-stitch",
        "INT-011-M02-RLS-LOGIN",
        "INT-011-host-tenant-header",
        "INT-013-REAL-SANDBOX-SIMULATED-fail-closed",
        "CMP-004-005-envelope-int",
        "CMP-036-host-composition-m02",
        "frozen-contracts-lock",
    ],
}
(root / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps({
    "result": summary["result"],
    "fail_count": summary["fail_count"],
    "failed": summary["failed_suites"],
    "CROSS_TENANT_LEAKAGE": leakage,
    "recommended_gate": summary["recommended_gate"],
}, indent=2))
sys.exit(0 if summary["result"] == "PASS" else 1)
PY
