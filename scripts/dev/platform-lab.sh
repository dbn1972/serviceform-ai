#!/usr/bin/env bash
# SAMPLE_LAB platform host (SF-M10-B-2/B-2c): PostgreSQL (FORCE RLS) + OPA + Temporal +
# CMP-004/009/015 API host with the CMP-016 sequencing worker in-process.
# LOCAL/CI only. SIMULATED OTP/IdP/DigiLocker. Not CERTIFIED. G6=false.
#
#   DATABASE_URL=postgres://admin@... scripts/dev/platform-lab.sh up     # bootstrap + start
#   scripts/dev/platform-lab.sh down                                     # stop
#
# Requires: opa on PATH (or OPA_BIN), pnpm install done. Writes state to .platform-lab/ (gitignored).
# Temporal: reuses a server already listening on SF_TEMPORAL_PORT; otherwise starts an in-memory
# dev server from TEMPORAL_BIN / `temporal` on PATH, or from the pinned, checksum-verified Temporal
# CLI release downloaded into .platform-lab/bin (linux amd64 only).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="${ROOT}/.platform-lab"
OPA="${OPA_BIN:-opa}"
OPA_PORT="${SF_OPA_PORT:-8181}"
API_PORT="${SF_PLATFORM_LAB_PORT:-4000}"
TEMPORAL_PORT="${SF_TEMPORAL_PORT:-7233}"
TEMPORAL_CLI_VERSION="1.5.0"
TEMPORAL_CLI_SHA256="0e847562a59ac7cbed38893bfd21944da4f2ff1213339963c79edf3685cc0c55"
export SF_TEMPORAL_PORT="${TEMPORAL_PORT}"
export SF_TEMPORAL_ADDRESS="127.0.0.1:${TEMPORAL_PORT}"
export SF_ENVIRONMENT="${SF_ENVIRONMENT:-LOCAL}"
export SF_OPA_URL="http://127.0.0.1:${OPA_PORT}"
export SF_PLATFORM_LAB_ENV_FILE="${STATE}/env"

stop() {
  for name in api opa temporal; do
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

port_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

wait_port() {
  local port="$1" tries=0
  until port_open "$port"; do
    tries=$((tries + 1))
    if [[ "$tries" -gt 120 ]]; then
      echo "platform-lab: timed out waiting for 127.0.0.1:${port}" >&2
      return 1
    fi
    sleep 0.5
  done
}

temporal_bin() {
  if [[ -n "${TEMPORAL_BIN:-}" ]]; then
    echo "$TEMPORAL_BIN"
    return
  fi
  if command -v temporal >/dev/null 2>&1; then
    command -v temporal
    return
  fi
  local dir="${STATE}/bin/temporal-${TEMPORAL_CLI_VERSION}"
  if [[ ! -x "${dir}/temporal" ]]; then
    if [[ "$(uname -s)/$(uname -m)" != "Linux/x86_64" ]]; then
      echo "platform-lab: install the Temporal CLI or set TEMPORAL_BIN" >&2
      return 1
    fi
    mkdir -p "$dir"
    local tgz="${dir}/temporal.tar.gz"
    curl -fsSL --retry 4 -o "$tgz" \
      "https://github.com/temporalio/cli/releases/download/v${TEMPORAL_CLI_VERSION}/temporal_cli_${TEMPORAL_CLI_VERSION}_linux_amd64.tar.gz"
    echo "${TEMPORAL_CLI_SHA256}  ${tgz}" | sha256sum -c --quiet - >&2
    tar -xzf "$tgz" -C "$dir" temporal
    rm -f "$tgz"
  fi
  echo "${dir}/temporal"
}

temporal_up() {
  if port_open "$TEMPORAL_PORT"; then
    echo "platform-lab: reusing Temporal at ${SF_TEMPORAL_ADDRESS}"
    return
  fi
  local bin
  bin="$(temporal_bin)"
  "$bin" server start-dev --ip 127.0.0.1 --port "$TEMPORAL_PORT" --headless \
    --log-level error >"${STATE}/temporal.log" 2>&1 &
  echo $! >"${STATE}/temporal.pid"
  wait_port "$TEMPORAL_PORT"
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
  temporal_up

  set -a
  # shellcheck disable=SC1091
  source "${STATE}/env"
  set +a
  (cd "$ROOT/apps/api" && HOST=127.0.0.1 PORT="$API_PORT" LOG_LEVEL="${LOG_LEVEL:-warn}" \
    exec pnpm exec tsx src/platform/lab-server.ts) >"${STATE}/api.log" 2>&1 &
  echo $! >"${STATE}/api.pid"
  wait_http "http://127.0.0.1:${API_PORT}/health/ready"
  echo "platform-lab: API http://127.0.0.1:${API_PORT} (SAMPLE_LAB, SIMULATED connectors, G6=false)"
  echo "platform-lab: Temporal ${SF_TEMPORAL_ADDRESS} (CMP-016 sequencing only; CMP-015 is authoritative)"
}

case "${1:-}" in
  up) up ;;
  down) stop ;;
  *)
    echo "usage: $0 up|down" >&2
    exit 2
    ;;
esac
