#!/usr/bin/env bash
# SAMPLE_LAB platform host (SF-M10-B-2): PostgreSQL (FORCE RLS) + OPA + CMP-004/009/015 API host.
# LOCAL/CI only. SIMULATED OTP/IdP/DigiLocker. Not CERTIFIED. G6=false.
#
#   DATABASE_URL=postgres://admin@... scripts/dev/platform-lab.sh up     # bootstrap + start
#   scripts/dev/platform-lab.sh down                                     # stop
#
# Requires: opa on PATH (or OPA_BIN), pnpm install done. Writes state to .platform-lab/ (gitignored).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="${ROOT}/.platform-lab"
OPA="${OPA_BIN:-opa}"
OPA_PORT="${SF_OPA_PORT:-8181}"
API_PORT="${SF_PLATFORM_LAB_PORT:-4000}"
export SF_ENVIRONMENT="${SF_ENVIRONMENT:-LOCAL}"
export SF_OPA_URL="http://127.0.0.1:${OPA_PORT}"
export SF_PLATFORM_LAB_ENV_FILE="${STATE}/env"

stop() {
  for name in api opa; do
    if [[ -f "${STATE}/${name}.pid" ]]; then
      kill "$(cat "${STATE}/${name}.pid")" 2>/dev/null || true
      rm -f "${STATE}/${name}.pid"
    fi
  done
}

wait_http() {
  local url="$1" header="${2:-}" tries=0
  until curl -fsS ${header:+-H "$header"} "$url" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [[ "$tries" -gt 120 ]]; then
      echo "platform-lab: timed out waiting for ${url}" >&2
      return 1
    fi
    sleep 0.5
  done
}

up() {
  : "${DATABASE_URL:?DATABASE_URL (admin) is required}"
  mkdir -p "$STATE"
  stop
  (cd "$ROOT/apps/api" && node scripts/platform-lab-bootstrap.mjs)

  # Bundle policy plus SAMPLE_LAB runtime tenant data (never committed under policy/opa).
  "$OPA" run --server "--addr=127.0.0.1:${OPA_PORT}" --authentication=token --authorization=basic \
    --ignore=.manifest --log-level=error \
    "${ROOT}/policy/opa" "${ROOT}/fixtures/lab/platform/opa" >"${STATE}/opa.log" 2>&1 &
  echo $! >"${STATE}/opa.pid"
  wait_http "${SF_OPA_URL}/health" "Authorization: Bearer pep"

  set -a
  # shellcheck disable=SC1091
  source "${STATE}/env"
  set +a
  (cd "$ROOT/apps/api" && HOST=127.0.0.1 PORT="$API_PORT" LOG_LEVEL="${LOG_LEVEL:-warn}" \
    exec pnpm exec tsx src/platform/lab-server.ts) >"${STATE}/api.log" 2>&1 &
  echo $! >"${STATE}/api.pid"
  wait_http "http://127.0.0.1:${API_PORT}/health/ready"
  echo "platform-lab: API http://127.0.0.1:${API_PORT} (SAMPLE_LAB, SIMULATED connectors, G6=false)"
}

case "${1:-}" in
  up) up ;;
  down) stop ;;
  *)
    echo "usage: $0 up|down" >&2
    exit 2
    ;;
esac
