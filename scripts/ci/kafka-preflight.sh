#!/usr/bin/env bash
# Prove pinned Kafka 4.1.0 KRaft can bind 127.0.0.1:19092 on this runner, then stop it.
# CMP-038 tests own the broker afterward (K3 stop/start). Failures must fail CI.
set -euo pipefail

KAFKA_HOME="${KAFKA_HOME:?KAFKA_HOME required}"
PORT="${SF_KAFKA_PORT:-19092}"
CONTROLLER_PORT="${SF_KAFKA_CONTROLLER_PORT:-19093}"
HEAP="${KAFKA_HEAP_OPTS:--Xmx512m}"
SCRATCH="${RUNNER_TEMP:-/tmp}/sf-kafka-preflight-$$"
LOG="$SCRATCH/broker.log"
PROPS="$SCRATCH/server.properties"

cleanup() {
  if [[ -n "${BROKER_PID:-}" ]] && kill -0 "$BROKER_PID" 2>/dev/null; then
    kill -TERM "-$BROKER_PID" 2>/dev/null || kill -TERM "$BROKER_PID" 2>/dev/null || true
    sleep 2
    kill -KILL "-$BROKER_PID" 2>/dev/null || kill -KILL "$BROKER_PID" 2>/dev/null || true
  fi
  if command -v lsof >/dev/null 2>&1; then
    for p in "$PORT" "$CONTROLLER_PORT"; do
      pids="$(lsof -t -iTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)"
      if [[ -n "$pids" ]]; then
        # shellcheck disable=SC2086
        kill -KILL $pids 2>/dev/null || true
      fi
    done
  fi
}
trap cleanup EXIT

echo "Kafka preflight: KAFKA_HOME=$KAFKA_HOME JAVA_HOME=${JAVA_HOME:-} java=$(command -v java)"
java -version
test -x "${KAFKA_HOME}/bin/kafka-server-start.sh"
test -x "${KAFKA_HOME}/bin/kafka-storage.sh"

mkdir -p "$SCRATCH/logs"
CLUSTER_ID="$(KAFKA_HEAP_OPTS='-Xmx64m' "${KAFKA_HOME}/bin/kafka-storage.sh" random-uuid | tr -d '[:space:]')"
cat >"$PROPS" <<EOF
process.roles=broker,controller
node.id=1
controller.quorum.bootstrap.servers=127.0.0.1:${CONTROLLER_PORT}
listeners=PLAINTEXT://127.0.0.1:${PORT},CONTROLLER://127.0.0.1:${CONTROLLER_PORT}
inter.broker.listener.name=PLAINTEXT
advertised.listeners=PLAINTEXT://127.0.0.1:${PORT},CONTROLLER://127.0.0.1:${CONTROLLER_PORT}
controller.listener.names=CONTROLLER
listener.security.protocol.map=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
log.dirs=${SCRATCH}/logs
num.network.threads=3
num.io.threads=4
num.partitions=1
offsets.topic.replication.factor=1
transaction.state.log.replication.factor=1
transaction.state.log.min.isr=1
group.initial.rebalance.delay.ms=0
auto.create.topics.enable=false
EOF

KAFKA_HEAP_OPTS='-Xmx256m' "${KAFKA_HOME}/bin/kafka-storage.sh" format \
  --standalone --ignore-formatted -t "$CLUSTER_ID" -c "$PROPS"

# Free ports before start (best-effort).
cleanup || true

set +e
setsid env KAFKA_HEAP_OPTS="$HEAP" "${KAFKA_HOME}/bin/kafka-server-start.sh" "$PROPS" >"$LOG" 2>&1 &
BROKER_PID=$!
set -e

echo "Waiting for 127.0.0.1:${PORT} (pid=${BROKER_PID})"
deadline=$((SECONDS + 90))
while (( SECONDS < deadline )); do
  if ! kill -0 "$BROKER_PID" 2>/dev/null; then
    echo "ERROR: Kafka broker exited during preflight" >&2
    tail -n 200 "$LOG" >&2 || true
    exit 1
  fi
  if (echo >"/dev/tcp/127.0.0.1/${PORT}") >/dev/null 2>&1; then
    echo "Kafka preflight OK on 127.0.0.1:${PORT}"
    exit 0
  fi
  sleep 1
done

echo "ERROR: timeout waiting for Kafka on 127.0.0.1:${PORT}" >&2
tail -n 200 "$LOG" >&2 || true
exit 1
