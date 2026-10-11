#!/usr/bin/env bash
# Independent SF-M03-INT runner. Does not patch component production code.
# Not CERTIFIED. Failures fail the caller (no continue-on-error waiver).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

OUT_ROOT="${M03_INT_OUT:-${ROOT}/evidence/SF-M03-INT}"
SHA="$(git rev-parse HEAD)"
RUN_ID="${GITHUB_RUN_ID:-local-m03-int}"
JOB="${GITHUB_JOB:-independent-m03-integration}"
RUNNER="${RUNNER_NAME:-$(hostname -s 2>/dev/null || hostname)}"
TS_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

export M03_COMMIT_SHA="$SHA"
export M03_INT_TS="$TS_UTC"
export M03_INT_OUT="$OUT_ROOT"
export GITHUB_SHA="${GITHUB_SHA:-$SHA}"

mkdir -p "$OUT_ROOT" "${OUT_ROOT}/junit" "${OUT_ROOT}/logs" test-results/m03-int/junit
rm -f "${OUT_ROOT}/.failed" test-results/m03-int/cross-tenant.json

: "${DATABASE_URL:?DATABASE_URL is required for M03 INT}"

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
  pnpm exec vitest run --config tests/integration/m03/vitest.config.ts \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/junit/independent-unit.xml" \
    2>&1 | tee "${OUT_ROOT}/logs/independent-unit.log"
  rc=${PIPESTATUS[0]}
  set -e
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  record SF-M03-INT INDEPENDENT independent-unit "$rc" "$started" "$finished" "${OUT_ROOT}/logs/independent-unit.log"
}

run_path SF-M03-008 CMP-036 host-composition-m03 apps/api/test/composition-m03.test.ts
run_path SF-M03-007 CMP-050 cmp-050-int002-unit \
  services/cmp-050-studio-portal/test/unit/int002-journey.test.ts \
  services/cmp-050-studio-portal/test/unit/headers.test.ts \
  services/cmp-050-studio-portal/test/contract/contracts.test.ts
run_path SF-M03-006 CMP-054 ux4g-foundation \
  packages/ui-ux4g/test/foundation.test.tsx \
  packages/ui-ux4g/test/app-shell.test.tsx

run_pkg_int SF-M03-001 CMP-001 @serviceform/cmp-001-catalogue
run_pkg_int SF-M03-002 CMP-033 @serviceform/cmp-033-metadata
run_pkg_int SF-M03-003 CMP-034 @serviceform/cmp-034-master-data
run_pkg_int SF-M03-004a CMP-051 @serviceform/cmp-051-maker-checker
run_pkg_int SF-M03-004b CMP-052 @serviceform/cmp-052-versioning
run_pkg_int SF-M03-005 CMP-053 @serviceform/cmp-053-localization

{
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  set +e
  pnpm exec vitest run --config tests/integration/m03/vitest.int.config.ts \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/junit/independent-int.xml" \
    2>&1 | tee "${OUT_ROOT}/logs/independent-int.log"
  rc=${PIPESTATUS[0]}
  set -e
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  record SF-M03-INT INDEPENDENT independent-int "$rc" "$started" "$finished" "${OUT_ROOT}/logs/independent-int.log"
}

{
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "${OUT_ROOT}/INT-013/junit"
  set +e
  pnpm --filter @serviceform/cmp-034-master-data run test:unit -- \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/INT-013/junit/cmp-034-unit.xml" \
    2>&1 | tee "${OUT_ROOT}/INT-013/cmp-034-unit.log"
  rc034=${PIPESTATUS[0]}
  pnpm --filter @serviceform/cmp-051-maker-checker run test:unit -- \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/INT-013/junit/cmp-051-unit.xml" \
    2>&1 | tee -a "${OUT_ROOT}/INT-013/cmp-051-unit.log"
  rc051=${PIPESTATUS[0]}
  pnpm --filter @serviceform/cmp-052-versioning run test:unit -- \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/INT-013/junit/cmp-052-unit.xml" \
    2>&1 | tee "${OUT_ROOT}/INT-013/cmp-052-unit.log"
  rc052=${PIPESTATUS[0]}
  pnpm --filter @serviceform/cmp-053-localization run test:unit -- \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/INT-013/junit/cmp-053-unit.xml" \
    2>&1 | tee "${OUT_ROOT}/INT-013/cmp-053-unit.log"
  rc053=${PIPESTATUS[0]}
  set -e
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  rc=0
  if [[ "$rc034" -ne 0 || "$rc051" -ne 0 || "$rc052" -ne 0 || "$rc053" -ne 0 ]]; then rc=1; fi
  record INT-013 MODES component-unit "$rc" "$started" "$finished" "${OUT_ROOT}/INT-013/cmp-034-unit.log"
}

python3 - <<'PY'
import json, os, pathlib, sys

root = pathlib.Path(os.environ["M03_INT_OUT"])
metas = sorted(root.glob("*/*.meta.json"))
suites = [json.loads(p.read_text(encoding="utf-8")) for p in metas]
failed = [s for s in suites if s.get("result") != "PASS"]
leak_path = pathlib.Path("test-results/m03-int/cross-tenant.json")
leakage = None
if leak_path.is_file():
    leakage = json.loads(leak_path.read_text(encoding="utf-8")).get("CROSS_TENANT_LEAKAGE")
if leakage is None:
    leakage = int(os.environ.get("CROSS_TENANT_LEAKAGE", "0") or "0")
hard_fail = failed or leakage != 0
summary = {
    "schema": "serviceform.m03.independent-int.summary.v1",
    "task_id": "SF-M03-INT",
    "commit_sha": os.environ.get("M03_COMMIT_SHA", ""),
    "github_run_id": os.environ.get("GITHUB_RUN_ID", "local-m03-int"),
    "github_job": os.environ.get("GITHUB_JOB", "independent-m03-integration"),
    "timestamp": os.environ.get("M03_INT_TS", ""),
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
        "INT-002-http-stitch",
        "INT-011-M03-RLS-LOGIN",
        "INT-011-host-tenant-header",
        "INT-013-REAL-SANDBOX-SIMULATED-fail-closed",
        "CMP-001-033-034-051-052-053-envelope-int",
        "CMP-050-studio-client",
        "CMP-054-ux4g-unit",
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
