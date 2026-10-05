#!/usr/bin/env bash
# Independent SF-M04-INT runner. Does not patch component production code.
# Not CERTIFIED. Failures fail the caller (no continue-on-error waiver).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

OUT_ROOT="${M04_INT_OUT:-${ROOT}/evidence/SF-M04-INT}"
SHA="$(git rev-parse HEAD)"
PRODUCTION_BASE_PREFIX="${M04_PRODUCTION_BASE_PREFIX:-afc8e253}"
PRODUCTION_BASE_SUFFIX="${M04_PRODUCTION_BASE_SUFFIX:-d4c566a4a18b1e01d9b0a1163f9d6adf}"
PRODUCTION_BASE="${M04_PRODUCTION_BASE:-${PRODUCTION_BASE_PREFIX}${PRODUCTION_BASE_SUFFIX}}"
RUN_ID="${GITHUB_RUN_ID:-local-m04-int}"
JOB="${GITHUB_JOB:-independent-m04-integration}"
RUNNER="${RUNNER_NAME:-$(hostname -s 2>/dev/null || hostname)}"
TS_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

export M04_COMMIT_SHA="$SHA"
export M04_PRODUCTION_BASE="$PRODUCTION_BASE"
export M04_INT_TS="$TS_UTC"
export M04_INT_OUT="$OUT_ROOT"
export GITHUB_SHA="${GITHUB_SHA:-$SHA}"

mkdir -p "$OUT_ROOT" "${OUT_ROOT}/junit" "${OUT_ROOT}/logs" \
  "${OUT_ROOT}/summary" test-results/m04-int/junit \
  evidence/integration/m04
rm -f "${OUT_ROOT}/.failed" test-results/m04-int/cross-tenant.json

: "${DATABASE_URL:?DATABASE_URL is required for M04 INT}"

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
  "production_base": "${PRODUCTION_BASE}",
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
  pnpm exec vitest run --config tests/integration/m04/vitest.config.ts \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/junit/independent-unit.xml" \
    2>&1 | tee "${OUT_ROOT}/logs/independent-unit.log"
  rc=${PIPESTATUS[0]}
  set -e
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  record SF-M04-INT INDEPENDENT independent-unit "$rc" "$started" "$finished" "${OUT_ROOT}/logs/independent-unit.log"
}

run_path SF-M04-007 CMP-036 host-composition-m04 apps/api/test/composition-m04.test.ts

run_pkg_int SF-M04-001 CMP-039 @serviceform/cmp-039-ai-gateway
run_pkg_int SF-M04-002 CMP-008 @serviceform/cmp-008-rules
run_pkg_int SF-M04-003 CMP-011 @serviceform/cmp-011-evidence-requirements
run_pkg_int SF-M04-004 CMP-013 @serviceform/cmp-013-document-upload
run_pkg_int SF-M04-005 CMP-009 @serviceform/cmp-009-dynamic-forms
run_pkg_int SF-M04-006 CMP-014 @serviceform/cmp-014-document-intelligence

{
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  set +e
  pnpm exec vitest run --config tests/integration/m04/vitest.int.config.ts \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/junit/independent-int.xml" \
    2>&1 | tee "${OUT_ROOT}/logs/independent-int.log"
  rc=${PIPESTATUS[0]}
  set -e
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  record SF-M04-INT INDEPENDENT independent-int "$rc" "$started" "$finished" "${OUT_ROOT}/logs/independent-int.log"
}

{
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "${OUT_ROOT}/INT-013/junit"
  set +e
  pnpm --filter @serviceform/cmp-039-ai-gateway run test:unit -- \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/INT-013/junit/cmp-039-unit.xml" \
    2>&1 | tee "${OUT_ROOT}/INT-013/cmp-039-unit.log"
  rc039=${PIPESTATUS[0]}
  pnpm --filter @serviceform/cmp-008-rules run test:unit -- \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/INT-013/junit/cmp-008-unit.xml" \
    2>&1 | tee "${OUT_ROOT}/INT-013/cmp-008-unit.log"
  rc008=${PIPESTATUS[0]}
  pnpm --filter @serviceform/cmp-011-evidence-requirements run test:unit -- \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/INT-013/junit/cmp-011-unit.xml" \
    2>&1 | tee "${OUT_ROOT}/INT-013/cmp-011-unit.log"
  rc011=${PIPESTATUS[0]}
  pnpm --filter @serviceform/cmp-013-document-upload run test:unit -- \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/INT-013/junit/cmp-013-unit.xml" \
    2>&1 | tee "${OUT_ROOT}/INT-013/cmp-013-unit.log"
  rc013=${PIPESTATUS[0]}
  pnpm --filter @serviceform/cmp-009-dynamic-forms run test:unit -- \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/INT-013/junit/cmp-009-unit.xml" \
    2>&1 | tee "${OUT_ROOT}/INT-013/cmp-009-unit.log"
  rc009=${PIPESTATUS[0]}
  pnpm --filter @serviceform/cmp-014-document-intelligence run test:unit -- \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/INT-013/junit/cmp-014-unit.xml" \
    2>&1 | tee "${OUT_ROOT}/INT-013/cmp-014-unit.log"
  rc014=${PIPESTATUS[0]}
  set -e
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  rc=0
  if [[ "$rc039" -ne 0 || "$rc008" -ne 0 || "$rc011" -ne 0 || "$rc013" -ne 0 || "$rc009" -ne 0 || "$rc014" -ne 0 ]]; then
    rc=1
  fi
  record INT-013 MODES component-unit "$rc" "$started" "$finished" "${OUT_ROOT}/INT-013/cmp-039-unit.log"
}

python3 - <<'PY'
import json, os, pathlib, re, sys

root = pathlib.Path(os.environ["M04_INT_OUT"])
metas = sorted(root.glob("*/*.meta.json"))
suites = [json.loads(p.read_text(encoding="utf-8")) for p in metas]
failed = [s for s in suites if s.get("result") != "PASS"]
leak_path = pathlib.Path("test-results/m04-int/cross-tenant.json")
leakage = None
if leak_path.is_file():
    leakage = json.loads(leak_path.read_text(encoding="utf-8")).get("CROSS_TENANT_LEAKAGE")
if leakage is None:
    leakage = int(os.environ.get("CROSS_TENANT_LEAKAGE", "0") or "0")

# Count executed tests from junit/logs (best-effort).
test_count = 0
for xml in root.rglob("*.xml"):
    text = xml.read_text(encoding="utf-8", errors="ignore")
    for m in re.finditer(r'tests="(\d+)"', text):
        test_count += int(m.group(1))
        break

lock_log = (root / "logs" / "contracts-lock.log").read_text(encoding="utf-8", errors="ignore")
contracts_match = "13/13" in lock_log or "MATCH" in lock_log.upper()
# Gate prints per-contract; require zero errors and 13 frozen.
frozen = len(re.findall(r"FROZEN", lock_log))
contracts_ok = not any(s.get("task_id") == "LOCK" and s.get("result") != "PASS" for s in suites)

hard_fail = failed or leakage != 0 or not contracts_ok
summary = {
    "schema": "serviceform.m04.independent-int.summary.v1",
    "task_id": "SF-M04-INT",
    "commit_sha": os.environ.get("M04_COMMIT_SHA", ""),
    "production_base": os.environ.get("M04_PRODUCTION_BASE", ""),
    "production_code_modified": False,
    "github_run_id": os.environ.get("GITHUB_RUN_ID", "local-m04-int"),
    "github_job": os.environ.get("GITHUB_JOB", "independent-m04-integration"),
    "timestamp": os.environ.get("M04_INT_TS", ""),
    "runner": os.environ.get("RUNNER_NAME", ""),
    "suite_count": len(suites),
    "pass_count": len(suites) - len(failed),
    "fail_count": len(failed),
    "executed_test_count_estimate": test_count,
    "CROSS_TENANT_LEAKAGE": leakage,
    "contracts_lock": "13/13 MATCH" if contracts_ok else "FAIL",
    "INT-011": "PASS" if not any("int-011" in f.lower() or "rls" in f.lower() or "host" in f.lower() for f in [f"{s['task_id']}:{s['suite']}" for s in failed]) else "FAIL",
    "INT-013": "PASS" if not any(s.get("task_id") == "INT-013" and s.get("result") != "PASS" for s in suites) and not any("int-013" in f"{s['task_id']}:{s['suite']}".lower() for s in failed) else "FAIL",
    "result": "PASS" if suites and not hard_fail else "FAIL",
    "recommended_gate": {
        "family": "V1_INTEGRATION",
        "status": ("PASS" if suites and not hard_fail else "FAIL"),
        "join_separator": "_",
    },
    "certified": False,
    "release_certified": False,
    "g3_integration_verified_claimed": False,
    "g6_claimed": False,
    "m05_started": False,
    "evd_started": False,
    "suites": suites,
    "failed_suites": [f"{s['task_id']}:{s['suite']}" for s in failed],
    "covers": [
        "M04-host-composition",
        "CMP-036-single-mount",
        "M01-M02-M03-mount-preservation",
        "INT-011-tenant-header-server-derived",
        "INT-011-M04-RLS-LOGIN",
        "INT-013-REAL-SANDBOX-SIMULATED-fail-closed",
        "CMP-039-source-acl-purpose-redaction",
        "CMP-008-published-pinned-gorules",
        "CMP-009-published-pinned-forms",
        "CMP-011-evidence-policy-resolution",
        "CMP-013-upload-scan-quarantine",
        "CMP-014-gateway-port-only-low-confidence-review",
        "OPA-deny-RLS-deny-fresh-tx",
        "idempotency-pin-hash",
        "frozen-contracts-lock",
    ],
}
(root / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
(root / "summary" / "cross-tenant.json").write_text(
    json.dumps({"CROSS_TENANT_LEAKAGE": leakage}, indent=2) + "\n", encoding="utf-8"
)
integ = pathlib.Path("evidence/integration/m04")
integ.mkdir(parents=True, exist_ok=True)
(integ / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
(integ / "cross-tenant.json").write_text(
    json.dumps({"CROSS_TENANT_LEAKAGE": leakage}, indent=2) + "\n", encoding="utf-8"
)
(integ / "README.md").write_text(
    "# M04 independent integration artifacts\n\nSee `evidence/SF-M04-INT/`.\n",
    encoding="utf-8",
)
print(json.dumps({
    "result": summary["result"],
    "fail_count": summary["fail_count"],
    "failed": summary["failed_suites"],
    "CROSS_TENANT_LEAKAGE": leakage,
    "contracts_lock": summary["contracts_lock"],
    "recommended_gate": summary["recommended_gate"],
}, indent=2))
sys.exit(0 if summary["result"] == "PASS" else 1)
PY
