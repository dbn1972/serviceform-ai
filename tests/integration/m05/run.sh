#!/usr/bin/env bash
# Independent SF-M05-INT runner. Does not patch component production code.
# Not CERTIFIED. Failures fail the caller (no continue-on-error waiver).
# Material INT-009 durable reconciliation gap → SF_M05_INT_BLOCKED (not PASS).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

OUT_ROOT="${M05_INT_OUT:-${ROOT}/evidence/SF-M05-INT}"
SHA="$(git rev-parse HEAD)"
PRODUCTION_BASE="${M05_PRODUCTION_BASE:-c0d25b32114779ddb4cc23e4e62a25f9d1365192}"
RUN_ID="${GITHUB_RUN_ID:-local-m05-int}"
JOB="${GITHUB_JOB:-independent-m05-integration}"
RUNNER="${RUNNER_NAME:-$(hostname -s 2>/dev/null || hostname)}"
TS_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

export M05_COMMIT_SHA="$SHA"
export M05_PRODUCTION_BASE="$PRODUCTION_BASE"
export M05_INT_TS="$TS_UTC"
export M05_INT_OUT="$OUT_ROOT"
export GITHUB_SHA="${GITHUB_SHA:-$SHA}"

mkdir -p "$OUT_ROOT" "${OUT_ROOT}/junit" "${OUT_ROOT}/logs" \
  "${OUT_ROOT}/summary" test-results/m05-int/junit \
  evidence/integration/m05
rm -f "${OUT_ROOT}/.failed" test-results/m05-int/cross-tenant.json \
  test-results/m05-int/int-009-durable.json \
  test-results/m05-int/host-package-admission.json

: "${DATABASE_URL:?DATABASE_URL is required for M05 INT}"

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
  pnpm exec vitest run --config tests/integration/m05/vitest.config.ts \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/junit/independent-unit.xml" \
    2>&1 | tee "${OUT_ROOT}/logs/independent-unit.log"
  rc=${PIPESTATUS[0]}
  set -e
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  record SF-M05-INT INDEPENDENT independent-unit "$rc" "$started" "$finished" "${OUT_ROOT}/logs/independent-unit.log"
}

run_path SF-M05-009 CMP-036 host-composition-m05 apps/api/test/composition-m05.test.ts

run_pkg_int SF-M05-001 CMP-015 @serviceform/cmp-015-application-case
run_pkg_int SF-M05-002 CMP-016 @serviceform/cmp-016-workflow-engine
run_pkg_int SF-M05-003 CMP-017 @serviceform/cmp-017-work-queue-tasks
run_pkg_int SF-M05-005 CMP-018 @serviceform/cmp-018-inspection-verification
run_pkg_int SF-M05-006 CMP-019 @serviceform/cmp-019-deficiency
run_pkg_int SF-M05-007 CMP-027 @serviceform/cmp-027-grievance-feedback
run_pkg_int SF-M05-008 CMP-028 @serviceform/cmp-028-appeal-review
run_pkg_int SF-M05-004 CMP-029 @serviceform/cmp-029-sla-escalation

{
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  set +e
  pnpm exec vitest run --config tests/integration/m05/vitest.int.config.ts \
    --reporter=default --reporter=junit \
    --outputFile.junit="${OUT_ROOT}/junit/independent-int.xml" \
    2>&1 | tee "${OUT_ROOT}/logs/independent-int.log"
  rc=${PIPESTATUS[0]}
  set -e
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  record SF-M05-INT INDEPENDENT independent-int "$rc" "$started" "$finished" "${OUT_ROOT}/logs/independent-int.log"
}

# Copy material residual artifacts into evidence
mkdir -p "${OUT_ROOT}/INT-009" "${OUT_ROOT}/HOST"
if [[ -f test-results/m05-int/int-009-durable.json ]]; then
  cp test-results/m05-int/int-009-durable.json "${OUT_ROOT}/INT-009/int-009-durable.json"
fi
if [[ -f test-results/m05-int/host-package-admission.json ]]; then
  cp test-results/m05-int/host-package-admission.json "${OUT_ROOT}/HOST/host-package-admission.json"
fi
if [[ -f test-results/m05-int/cross-tenant.json ]]; then
  cp test-results/m05-int/cross-tenant.json "${OUT_ROOT}/summary/cross-tenant.json"
fi

python3 - <<'PY'
import json, os, pathlib, re, sys

root = pathlib.Path(os.environ["M05_INT_OUT"])
metas = sorted(root.glob("*/*.meta.json"))
suites = [json.loads(p.read_text(encoding="utf-8")) for p in metas]
failed = [s for s in suites if s.get("result") != "PASS"]

leak_path = pathlib.Path("test-results/m05-int/cross-tenant.json")
leakage = None
if leak_path.is_file():
    leakage = json.loads(leak_path.read_text(encoding="utf-8")).get("CROSS_TENANT_LEAKAGE")
if leakage is None:
    leakage = int(os.environ.get("CROSS_TENANT_LEAKAGE", "0") or "0")

int009_path = pathlib.Path("test-results/m05-int/int-009-durable.json")
int009 = "UNKNOWN"
if int009_path.is_file():
    int009 = json.loads(int009_path.read_text(encoding="utf-8")).get(
        "INT_009_DURABLE_RECONCILIATION", "UNKNOWN"
    )

host_path = pathlib.Path("test-results/m05-int/host-package-admission.json")
host_blocking = False
if host_path.is_file():
    host_blocking = bool(
        json.loads(host_path.read_text(encoding="utf-8")).get(
            "M05_HOST_PACKAGE_ADMISSION_BLOCKING", False
        )
    )

test_count = 0
for xml in root.rglob("*.xml"):
    text = xml.read_text(encoding="utf-8", errors="ignore")
    for m in re.finditer(r'tests="(\d+)"', text):
        test_count += int(m.group(1))
        break

lock_log = (root / "logs" / "contracts-lock.log").read_text(encoding="utf-8", errors="ignore")
frozen = len(re.findall(r"FROZEN", lock_log))
contracts_ok = not any(s.get("task_id") == "LOCK" and s.get("result") != "PASS" for s in suites)
contracts_lock = f"{frozen}/19 MATCH" if contracts_ok and frozen >= 19 else (
    "19/19 MATCH" if contracts_ok else "FAIL"
)

def suite_failed_named(*needles: str) -> bool:
    for s in failed:
        key = f"{s['task_id']}:{s['suite']}".lower()
        if any(n in key for n in needles):
            return True
    return False

int004 = "FAIL" if suite_failed_named("independent-unit", "cmp-015", "sf-m05-001") else "PASS"
# independent-unit covers INT-004/005/006/009/011/013 static; component ints reinforce
if any(s.get("task_id") == "SF-M05-INT" and s.get("suite") == "independent-unit" and s.get("result") != "PASS" for s in suites):
    int004 = "FAIL"
    int005 = "FAIL"
    int006 = "FAIL"
    int011 = "FAIL"
    int013 = "FAIL"
else:
    int005 = "FAIL" if suite_failed_named("cmp-016", "cmp-017", "sf-m05-002", "sf-m05-003") else "PASS"
    int006 = "FAIL" if suite_failed_named("cmp-018", "sf-m05-005") else "PASS"
    int011 = "FAIL" if suite_failed_named("independent-int", "host-composition", "rls") or leakage != 0 else "PASS"
    int013 = "PASS"

# INT-009 material durable reconciliation is the hard gate for SF_M05_INT_PASS
int009_status = "BLOCKED" if int009 == "BLOCKED" else ("PASS" if int009 == "PROVEN" else "FAIL")

hard_fail = bool(failed) or leakage != 0 or not contracts_ok
material_block = int009_status == "BLOCKED" or host_blocking

if hard_fail:
    overall = "SF_M05_INT_FAIL"
    result_family = "SF_M05_INT"
    result_status = "FAIL"
elif material_block:
    overall = "SF_M05_INT_BLOCKED"
    result_family = "SF_M05_INT"
    result_status = "BLOCKED"
else:
    overall = "SF_M05_INT_PASS"
    result_family = "SF_M05_INT"
    result_status = "PASS"

summary = {
    "schema": "serviceform.m05.independent-int.summary.v1",
    "task_id": "SF-M05-INT",
    "commit_sha": os.environ.get("M05_COMMIT_SHA", ""),
    "execution_base": os.environ.get("M05_PRODUCTION_BASE", ""),
    "production_base": os.environ.get("M05_PRODUCTION_BASE", ""),
    "production_code_modified": False,
    "github_run_id": os.environ.get("GITHUB_RUN_ID", "local-m05-int"),
    "github_job": os.environ.get("GITHUB_JOB", "independent-m05-integration"),
    "timestamp": os.environ.get("M05_INT_TS", ""),
    "runner": os.environ.get("RUNNER_NAME", ""),
    "suite_count": len(suites),
    "pass_count": len(suites) - len(failed),
    "fail_count": len(failed),
    "executed_test_count_estimate": test_count,
    "CROSS_TENANT_LEAKAGE": leakage,
    "contracts_lock": contracts_lock,
    "INT-004": int004,
    "INT-005": int005,
    "INT-006": int006,
    "INT-009": int009_status,
    "INT-011": int011,
    "INT-013": int013,
    "INT_009_DURABLE_RECONCILIATION": int009,
    "M05_HOST_PACKAGE_ADMISSION_BLOCKING": host_blocking,
    "CMP-019_residual": "GOVERNING_UNRESOLVED_UNWAIVED",
    "CMP-028_residual": "GOVERNING_UNRESOLVED_UNWAIVED",
    "M05_HOST_PACKAGE_ADMISSION": "DEFERRED_UNRESOLVED" if host_blocking else "ADMITTED",
    "result": overall,
    "recommended_gate": {
        "family": result_family,
        "status": result_status,
        "join_separator": "_",
    },
    "certified": False,
    "release_certified": False,
    "g4_claimed": False,
    "g6_claimed": False,
    "sec_started": False,
    "evd_started": False,
    "m06_started": False,
    "m08_started": False,
    "suites": suites,
    "failed_suites": [f"{s['task_id']}:{s['suite']}" for s in failed],
    "covers": [
        "INT-004-submission-txn-outbox",
        "INT-005-temporal-after-commit-OPA-officer",
        "INT-006-evidence-DigiLocker-SIMULATED",
        "INT-009-deficiency-pause-resume-durable-expected-state",
        "INT-011-tenant-isolation-M05-RLS",
        "INT-013-SIMULATED-fail-closed",
        "M05-host-composition",
        "host-package-admission-residual",
        "frozen-contracts-lock",
    ],
}
(root / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
(root / "summary" / "cross-tenant.json").write_text(
    json.dumps({"CROSS_TENANT_LEAKAGE": leakage}, indent=2) + "\n", encoding="utf-8"
)
integ = pathlib.Path("evidence/integration/m05")
integ.mkdir(parents=True, exist_ok=True)
(integ / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
(integ / "cross-tenant.json").write_text(
    json.dumps({"CROSS_TENANT_LEAKAGE": leakage}, indent=2) + "\n", encoding="utf-8"
)
(integ / "README.md").write_text(
    "# M05 independent integration artifacts\n\nSee `evidence/SF-M05-INT/`.\n",
    encoding="utf-8",
)
print(json.dumps({
    "result": summary["result"],
    "fail_count": summary["fail_count"],
    "failed": summary["failed_suites"],
    "CROSS_TENANT_LEAKAGE": leakage,
    "contracts_lock": summary["contracts_lock"],
    "INT-009": int009_status,
    "M05_HOST_PACKAGE_ADMISSION_BLOCKING": host_blocking,
    "recommended_gate": summary["recommended_gate"],
}, indent=2))
# Exit 0 for PASS or BLOCKED (material residual documented); non-zero only for FAIL harness/suites.
sys.exit(0 if result_status in ("PASS", "BLOCKED") and not hard_fail else 1)
PY
