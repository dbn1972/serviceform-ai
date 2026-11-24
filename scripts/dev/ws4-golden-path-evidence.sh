#!/usr/bin/env bash
# Workstream 4 — Golden path proof (Residence + Income SAMPLE_LAB ceiling).
# Requires: DATABASE_URL (admin), opa on PATH, pnpm install, web shells built,
#           scripts/dev/platform-lab.sh up already running (API :4000).
# Odisha public sample gate: SF_M10_OWNER_INPUTS_READY=1
# CERTIFIED=false · G6=false · DigiLocker SIMULATED · no invented Income statute.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

: "${DATABASE_URL:?DATABASE_URL (admin) is required}"
export SF_ENVIRONMENT="${SF_ENVIRONMENT:-LOCAL}"
export SF_API_BASE_URL="${SF_API_BASE_URL:-http://127.0.0.1:4000}"
export SF_PORTAL_PLACEMENT_FILE="${SF_PORTAL_PLACEMENT_FILE:-$ROOT/fixtures/lab/platform/placement.citizen.json}"
export SF_M10_OWNER_INPUTS_READY="${SF_M10_OWNER_INPUTS_READY:-1}"
export NEXT_TELEMETRY_DISABLED=1

OUT="${ROOT}/evidence/WS4-GOLDEN-PATH"
mkdir -p "${OUT}/logs" "${OUT}/junit"

curl -fsS "${SF_API_BASE_URL}/health/ready" >/dev/null

TIP="$(git rev-parse HEAD)"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

pnpm --filter @serviceform/service-templates exec vitest run \
  test/catalogue.test.ts \
  test/m11-income-dry-run-fixtures.test.ts \
  test/lab-offer-sample-data.test.ts \
  | tee "${OUT}/logs/unit-templates.log"

pnpm --filter @serviceform/web-citizen exec vitest run \
  test/m11-income-gated.test.ts \
  | tee "${OUT}/logs/unit-citizen-income-gate.log"

# Full e2e suite includes golden + M11 + Studio designers + platform journey.
pnpm e2e | tee "${OUT}/logs/e2e-golden-m11.log"
cp -f test-results/e2e/junit.xml "${OUT}/junit/e2e.xml" 2>/dev/null || true
cp -f test-results/e2e/results.json "${OUT}/junit/results.json" 2>/dev/null || true

ENDED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat >"${OUT}/summary.json" <<JSON
{
  "schema": "serviceform.ws4.golden-path.summary.v1",
  "commit_sha": "${TIP}",
  "started_at": "${STARTED_AT}",
  "ended_at": "${ENDED_AT}",
  "environment_label": "SAMPLE_LAB",
  "connectors": { "digilocker": "SIMULATED", "otp": "SIMULATED", "idp": "SIMULATED", "sms": "SIMULATED", "payment": "SIMULATED" },
  "certified": false,
  "g6": false,
  "self_certified": false,
  "sf33_income_statute": "BLOCKED",
  "residence_catalogue_id": "IND-SOC-002",
  "income_catalogue_id": "IND-SOC-031",
  "notes": "Lab-offer of Income DRAFT/DUMMY is not statutory PUBLISH. SF-33 owner policy package required."
}
JSON

echo "ws4-golden-path-evidence: wrote ${OUT} (tip=${TIP}, CERTIFIED=false, G6=false)"
