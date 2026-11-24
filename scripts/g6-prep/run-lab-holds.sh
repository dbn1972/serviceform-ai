#!/usr/bin/env bash
# Workstream 5 — run fail-closed G6 prep hold suites (lab). Does not set READY flags.
# Does not claim G5/resilience PASS, DigiLocker REAL, or G6.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
EVIDENCE="$ROOT/evidence/SF-WS5-G6-PREP"
mkdir -p "$EVIDENCE/junit" "$EVIDENCE/logs"
unset SF_M10_G5_PERF_READY SF_M10_RESILIENCE_READY SF_M10_UX4G_READY || true

echo "== G5 hold + harness scaffold =="
pnpm exec vitest run --config tests/performance/m10/vitest.config.ts \
  2>&1 | tee "$EVIDENCE/logs/g5-hold.log"
# Copy junit if vitest wrote the G6-PREREQ path (shared config); also keep WS5 log.
if [[ -f evidence/SF-M10-G6-PREREQ/junit/g5-hold.xml ]]; then
  cp evidence/SF-M10-G6-PREREQ/junit/g5-hold.xml "$EVIDENCE/junit/g5-hold.xml"
fi

echo "== Resilience + backup/rollback hold =="
pnpm exec vitest run --config tests/resilience/m10/vitest.config.ts \
  2>&1 | tee "$EVIDENCE/logs/resilience-hold.log"
if [[ -f evidence/SF-M10-G6-PREREQ/junit/resilience-hold.xml ]]; then
  cp evidence/SF-M10-G6-PREREQ/junit/resilience-hold.xml "$EVIDENCE/junit/resilience-hold.xml"
fi

echo "== G6 connector hold + prep stubs =="
pnpm exec vitest run --config tests/integration/m10/vitest.config.ts \
  tests/integration/m10/g6-connector-hold.test.ts \
  tests/integration/m10/g6-prep-stubs.test.ts \
  2>&1 | tee "$EVIDENCE/logs/connector-prep.log"
if [[ -f evidence/SF-M10-003/junit/m10-int.xml ]]; then
  cp evidence/SF-M10-003/junit/m10-int.xml "$EVIDENCE/junit/connector-prep.xml"
fi

echo "CERTIFIED=false G6=false — lab holds only. See $EVIDENCE/EVIDENCE.md"
