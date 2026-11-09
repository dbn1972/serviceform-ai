#!/usr/bin/env bash
# SF-M10-B-INT independent integration run (LOCAL only, synthetic data, not CERTIFIED).
#
#   DATABASE_URL=postgres://<admin>@localhost:<port>/<db> tests/integration/m10-platform/run.sh
#
# Brings up host A with scripts/dev/platform-lab.sh (fixtures/lab/platform), derives a second
# synthetic tenant B, starts OPA B + host B against the same database and Temporal server (own
# task queue), runs the suite, and stops both hosts. Ports default to the SF-M10-B-INT allocation and can be overridden.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HERE="${ROOT}/tests/integration/m10-platform"
: "${DATABASE_URL:?DATABASE_URL (admin) is required}"
OPA="${OPA_BIN:-opa}"
A_API="${SF_INT_A_API_PORT:-4200}"
A_OPA="${SF_INT_A_OPA_PORT:-8381}"
B_API="${SF_INT_B_API_PORT:-4201}"
B_OPA="${SF_INT_B_OPA_PORT:-8382}"
WORK="${SF_INT_WORK_DIR:-$(mktemp -d)}"
EVIDENCE="${ROOT}/evidence/SF-M10-B-INT"
mkdir -p "${WORK}" "${EVIDENCE}/logs" "${EVIDENCE}/junit"

pids=()
teardown() {
  for pid in "${pids[@]:-}"; do
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  done
  if [[ "${SF_INT_KEEP_HOSTS:-0}" != "1" ]]; then
    bash "${ROOT}/scripts/dev/platform-lab.sh" down || true
  fi
}
trap teardown EXIT

wait_http() {
  local url="$1" header="${2:-}" tries=0
  until curl -fsS ${header:+-H "$header"} "$url" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [[ "$tries" -gt 120 ]]; then
      echo "m10-platform: timed out waiting for ${url}" >&2
      return 1
    fi
    sleep 0.5
  done
}

SF_ENVIRONMENT=LOCAL SF_OPA_PORT="${A_OPA}" SF_PLATFORM_LAB_PORT="${A_API}" \
  bash "${ROOT}/scripts/dev/platform-lab.sh" up

node "${HERE}/support/tenant-b.mjs" "${WORK}/platform-b"
"$OPA" run --server "--addr=127.0.0.1:${B_OPA}" --authentication=token --authorization=basic \
  --ignore=.manifest --log-level=error \
  "${ROOT}/policy/opa" "${WORK}/platform-b/opa" >"${WORK}/opa-b.log" 2>&1 &
pids+=($!)
wait_http "http://127.0.0.1:${B_OPA}/health" "Authorization: Bearer pep"

(
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.platform-lab/env"
  set +a
  export SF_ENVIRONMENT=LOCAL SF_PLATFORM_LAB_DIR="${WORK}/platform-b" \
    SF_OPA_URL="http://127.0.0.1:${B_OPA}" \
    SF_TEMPORAL_TASK_QUEUE="sf-sample-lab-workflow-b"
  cd "${ROOT}/apps/api"
  HOST=127.0.0.1 PORT="${B_API}" LOG_LEVEL=warn exec pnpm exec tsx src/platform/lab-server.ts
) >"${WORK}/api-b.log" 2>&1 &
pids+=($!)
wait_http "http://127.0.0.1:${B_API}/health/ready"
echo "m10-platform: host A :${A_API} (OPA :${A_OPA}), host B :${B_API} (OPA :${B_OPA})"

cd "${ROOT}"
SF_INT_HOST_A="http://127.0.0.1:${A_API}" \
  SF_INT_HOST_B="http://127.0.0.1:${B_API}" \
  SF_INT_ADMIN_URL="${DATABASE_URL}" \
  SF_INT_TENANT_B_DIR="${WORK}/platform-b" \
  SF_INT_LAB_ENV_FILE="${ROOT}/.platform-lab/env" \
  pnpm exec vitest run --config "${HERE}/vitest.config.ts" "$@"
