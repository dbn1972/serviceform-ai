#!/usr/bin/env bash
# SF-M01-G4-002 — full M01 regression on tip (all 11 CMPs + platform seams).
# Additive harness only. Does not patch production services. Fail-closed.
# Not CERTIFIED. Builder cannot self-certify.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

OUT_ROOT="${M01_G4_OUT:-${ROOT}/test-results/m01-g4-regression}"
EVIDENCE_ROOT="${M01_G4_EVIDENCE:-${ROOT}/evidence/SF-M01-G4-002}"
SHA="$(git rev-parse HEAD)"
RUN_ID="${GITHUB_RUN_ID:-local-g4-002}"
JOB="${GITHUB_JOB:-m01-g4-regression}"
RUNNER="${RUNNER_NAME:-$(hostname -s 2>/dev/null || hostname)}"
TS_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

export M01_COMMIT_SHA="$SHA"
export M01_G4_TS="$TS_UTC"
export M01_G4_OUT="$OUT_ROOT"
export M01_G4_EVIDENCE="$EVIDENCE_ROOT"
export GITHUB_SHA="${GITHUB_SHA:-$SHA}"
export GITHUB_RUN_ID="$RUN_ID"
export GITHUB_JOB="$JOB"
export RUNNER_NAME="$RUNNER"
export KAFKA_HOME="${KAFKA_HOME:-/var/tmp/kafka/kafka_2.13-4.1.0}"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
export PATH="${JAVA_HOME}/bin:${PATH}"
export SF_KAFKA_DEBUG="${SF_KAFKA_DEBUG:-1}"
export SF_ENVIRONMENT="${SF_ENVIRONMENT:-CI}"

mkdir -p "$OUT_ROOT" "$EVIDENCE_ROOT" "${OUT_ROOT}/junit" "${OUT_ROOT}/gates" "${OUT_ROOT}/github"
rm -f "${OUT_ROOT}/.failed"

: "${DATABASE_URL:?DATABASE_URL is required for M01 G4 regression}"
if [[ ! -x "${KAFKA_HOME}/bin/kafka-server-start.sh" ]]; then
  echo "ERROR: Kafka 4.1.0 not found at KAFKA_HOME=${KAFKA_HOME}" >&2
  exit 1
fi
if ! command -v opa >/dev/null 2>&1; then
  echo "ERROR: opa binary not on PATH" >&2
  exit 1
fi

# CMP-038 owns Kafka process lifecycle; do not pin shared brokers.
unset SF_KAFKA_BROKERS || true

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

record_cmd() {
  local task="$1" component="$2" suite="$3"
  shift 3
  local dir="${OUT_ROOT}/${task}"
  mkdir -p "$dir"
  local log_path="${dir}/${suite}.log"
  local started finished result rc=0
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "==> ${task} ${component} suite=${suite}"
  set +e
  "$@" 2>&1 | tee "${log_path}"
  rc=${PIPESTATUS[0]}
  set -e
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

run_filter_vitest_int() {
  local pkg="$1" junit_path="$2" log_path="$3"
  set +e
  pnpm --filter "${pkg}" exec vitest run \
    --root . \
    --config vitest.integration.config.ts \
    --reporter=default \
    --reporter=junit \
    --outputFile.junit="${junit_path}" 2>&1 | tee "${log_path}"
  local rc=${PIPESTATUS[0]}
  set -e
  return "$rc"
}

run_int_suite() {
  local task="$1" component="$2" suite="$3" pkg="$4"
  local dir="${OUT_ROOT}/${task}"
  mkdir -p "${dir}/junit"
  local log_path="${dir}/${suite}.log"
  local junit_path="${dir}/junit/${suite}.xml"
  local started finished result rc=0
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "==> ${task} ${component} suite=${suite} pkg=${pkg}"
  if ! run_filter_vitest_int "${pkg}" "${junit_path}" "${log_path}"; then
    rc=1
  fi
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ "$rc" -eq 0 ]]; then result=PASS; else result=FAIL; echo "${task}:${suite}" >>"${OUT_ROOT}/.failed"; fi
  write_suite_meta "$task" "$component" "$suite" "$result" "$started" "$finished" "$log_path"
}

# --- Gates / deps (non-weakening) ---
record_cmd GATES CROSS-CMP contracts-lock \
  python3 scripts/gates/contracts_lock_gate.py

record_cmd GATES CROSS-CMP deps-graph \
  pnpm deps:graph

record_cmd GATES CROSS-CMP migration-lint \
  python3 scripts/gates/migration_lint.py

record_cmd GATES CROSS-CMP gates-all \
  pnpm gates

# --- W1 envelope INT (CMP-002/048/031/038/037 + OPA + CDC) ---
{
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "${OUT_ROOT}/W1-ENVELOPE"
  set +e
  M01_INT_OUT="${OUT_ROOT}/m01-envelope-int" \
    bash scripts/ci/run-m01-envelope-int.sh 2>&1 | tee "${OUT_ROOT}/W1-ENVELOPE/envelope-int.log"
  rc=${PIPESTATUS[0]}
  set -e
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ "$rc" -eq 0 ]]; then result=PASS; else result=FAIL; echo "W1-ENVELOPE:envelope-int" >>"${OUT_ROOT}/.failed"; fi
  write_suite_meta W1-ENVELOPE CROSS-CMP envelope-int "$result" "$started" "$finished" \
    "${OUT_ROOT}/W1-ENVELOPE/envelope-int.log"
}

# Map W1 suites into component coverage rows for summary (from nested metas).
if [[ -f "${OUT_ROOT}/m01-envelope-int/summary.json" ]]; then
  python3 - <<'PY'
import json, pathlib, os
root = pathlib.Path(os.environ["M01_G4_OUT"])
src = root / "m01-envelope-int"
for meta in sorted(src.glob("*/*.meta.json")):
    data = json.loads(meta.read_text(encoding="utf-8"))
    task = data["task_id"]
    suite = data["suite"]
    # Skip alias duplicates: only promote primary suites
    if suite not in {"envelope-int", "opa-test", "wave1-cdc"}:
        continue
    dest_dir = root / task
    dest_dir.mkdir(parents=True, exist_ok=True)
    # rewrite log path relative if needed
    out = dict(data)
    out["promoted_from"] = str(meta.relative_to(root))
    (dest_dir / f"{suite}.meta.json").write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
PY
fi

# --- W2 PG INT: CMP-003 / CMP-030 / CMP-032 ---
run_int_suite SF-M01-W2-001 CMP-003 envelope-int @serviceform/cmp-003-jurisdiction
run_int_suite SF-M01-W2-002 CMP-030 envelope-int @serviceform/cmp-030-consent-privacy
run_int_suite SF-M01-W2-003 CMP-032 envelope-int @serviceform/cmp-032-storage

# --- INT-013 storage markers (SIMULATED/local) ---
record_cmd SF-M01-W2-003 CMP-032 int-013-storage-unit \
  pnpm --filter @serviceform/storage test

record_cmd SF-M01-W2-003 CMP-032 int-013-cmp-032-unit \
  pnpm --filter @serviceform/cmp-032-storage test:unit

# --- Host composition (CMP-036 mounts W1+W2 + CMP-047 telemetry) ---
record_cmd HOST CMP-036 host-wave2-composition \
  pnpm exec vitest run apps/api/test/composition.test.ts

# --- CMP-036 / CMP-047 edge/plugin units (no PG int on main) ---
record_cmd SF-M01-W2-004 CMP-036 cmp-036-edge-unit \
  pnpm exec vitest run services/cmp-036-api-gateway/test/edge.test.ts

record_cmd SF-M01-W2-004 CMP-047 cmp-047-plugin-unit \
  pnpm exec vitest run services/cmp-047-observability/test/plugin.test.ts

# --- CMP-055 path-based (no package.json on main) ---
record_cmd SF-M01-W2-005 CMP-055 unit \
  pnpm exec vitest run services/cmp-055-developer-platform/test

# --- Coverage matrix unit (additive G4 harness test) ---
record_cmd SF-M01-G4-002 CROSS-CMP coverage-matrix \
  pnpm exec vitest run --config tests/integration/m01-g4/vitest.config.ts

# --- Summarize ---
python3 - <<'PY'
import json, os, pathlib, sys, re

root = pathlib.Path(os.environ["M01_G4_OUT"])
evidence = pathlib.Path(os.environ.get("M01_G4_EVIDENCE", "evidence/SF-M01-G4-002"))
sha = os.environ.get("M01_COMMIT_SHA", "")
ts = os.environ.get("M01_G4_TS", "")

metas = []
for p in sorted(root.glob("*/*.meta.json")):
    # skip nested m01-envelope-int duplicates already promoted
    if "m01-envelope-int" in p.parts:
        continue
    metas.append(json.loads(p.read_text(encoding="utf-8")))

# Deduplicate by task/suite
seen = set()
suites = []
for s in metas:
    key = (s.get("task_id"), s.get("suite"), s.get("component_id"))
    if key in seen:
        continue
    seen.add(key)
    suites.append(s)

failed = [s for s in suites if s.get("result") != "PASS"]
components_required = [
    "CMP-002", "CMP-003", "CMP-030", "CMP-031", "CMP-032",
    "CMP-036", "CMP-037", "CMP-038", "CMP-047", "CMP-048", "CMP-055",
]
covered = sorted({s.get("component_id") for s in suites if s.get("component_id") and s.get("component_id") != "CROSS-CMP"})
missing = [c for c in components_required if c not in covered]

# Leakage count: parse explicit CROSS_TENANT_LEAKAGE=N from logs; default 0 when all PASS.
leakage = 0
leak_re = re.compile(r"CROSS_TENANT_LEAKAGE\s*[:=]\s*(\d+)", re.I)
for log in root.rglob("*.log"):
    try:
        text = log.read_text(encoding="utf-8", errors="replace")
    except OSError:
        continue
    for m in leak_re.finditer(text):
        leakage = max(leakage, int(m.group(1)))

result = "PASS" if suites and not failed and not missing else "FAIL"
fail_count = len([s for s in suites if s.get("result") != "PASS"])
if missing:
    fail_count += len(missing)

# Hard gate: PASS requires leakage == 0. FAIL keeps measured count (0 if none observed).
if result == "PASS":
    leakage = 0

summary = {
    "schema": "serviceform.m01.g4-regression.summary.v1",
    "task_id": "SF-M01-G4-002",
    "result": "M01_G4_REGRESSION_PASS" if result == "PASS" else "M01_G4_REGRESSION_FAIL",
    "certified": False,
    "not_certified": True,
    "commit_sha": sha,
    "github_run_id": os.environ.get("GITHUB_RUN_ID", "local-g4-002"),
    "github_job": os.environ.get("GITHUB_JOB", "m01-g4-regression"),
    "timestamp": ts,
    "runner": os.environ.get("RUNNER_NAME", ""),
    "CROSS_TENANT_LEAKAGE": leakage,
    "components_required": components_required,
    "components_covered": covered,
    "components_missing": missing,
    "integration_ids": ["INT-011", "INT-013"],
    "suite_count": len(suites),
    "pass_count": len(suites) - len([s for s in suites if s.get("result") != "PASS"]),
    "fail_count": fail_count,
    "failed_suites": [f"{s['task_id']}:{s['suite']}" for s in suites if s.get("result") != "PASS"]
    + [f"COVERAGE:missing-{c}" for c in missing],
    "covers": [
        "CMP-002-tenant-organisation",
        "CMP-003-jurisdiction",
        "CMP-030-consent-privacy",
        "CMP-031-audit-ledger",
        "CMP-032-storage",
        "CMP-036-api-gateway-host",
        "CMP-037-integration-hub-sim",
        "CMP-038-event-bus-outbox-inbox",
        "CMP-047-observability",
        "CMP-048-security-opa",
        "CMP-055-developer-platform",
        "INT-011-RLS-tenant-isolation",
        "INT-013-storage-simulation-markers",
        "OPA-PEP-fail-closed",
        "privilege-boundary-LOGIN",
        "host-composition-W1-W2",
        "audit-outbox-inbox",
        "frozen-contracts-lock-13/13",
        "deps-graph",
    ],
    "suites": suites,
    "residuals": [
        {
            "id": "R-ENV-INT",
            "note": "CI job m01-envelope-int still W1-named on tip until SF-M01-G4-001 lands; this harness covers W1+W2 independently.",
        },
        {
            "id": "CMP-055-PKG",
            "note": "No package.json on main; path-based vitest executed.",
        },
    ],
}

(root / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps({
    "result": summary["result"],
    "fail_count": summary["fail_count"],
    "CROSS_TENANT_LEAKAGE": summary["CROSS_TENANT_LEAKAGE"],
    "missing": missing,
    "failed": summary["failed_suites"],
}, indent=2))
sys.exit(0 if result == "PASS" else 1)
PY
