#!/usr/bin/env bash
# P8-6 Golden-2 — Residence golden held + Income DRAFT/DUMMY lab ceiling + SF-33 PUBLISH blocker.
# Requires: DATABASE_URL (admin), opa on PATH, pnpm install, web shells built,
#           scripts/dev/platform-lab.sh up already running (API :4000).
# Odisha public sample gate: SF_M10_OWNER_INPUTS_READY=1
# CERTIFIED=false · G6=false · DigiLocker SIMULATED · DigiLocker REAL out of scope · no invented Income statute.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

: "${DATABASE_URL:?DATABASE_URL (admin) is required}"
export SF_ENVIRONMENT="${SF_ENVIRONMENT:-LOCAL}"
export SF_API_BASE_URL="${SF_API_BASE_URL:-http://127.0.0.1:4000}"
export SF_PORTAL_PLACEMENT_FILE="${SF_PORTAL_PLACEMENT_FILE:-$ROOT/fixtures/lab/platform/placement.citizen.json}"
export SF_M10_OWNER_INPUTS_READY="${SF_M10_OWNER_INPUTS_READY:-1}"
export NEXT_TELEMETRY_DISABLED=1

OUT="${ROOT}/evidence/SF-P8-GOLDEN2"
mkdir -p "${OUT}/logs" "${OUT}/junit" "${OUT}/fixtures"

curl -fsS "${SF_API_BASE_URL}/health/ready" >/dev/null

TIP="$(git rev-parse HEAD)"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STARTED_IST="$(TZ=Asia/Kolkata date '+%Y-%m-%d %H:%M Asia/Calcutta')"

echo "${TIP}" >"${OUT}/code-sha.txt"

# Honesty fixtures (copied for evidence binding; source of truth remains fixtures/m11).
cp -f "${ROOT}/fixtures/m11/ind-soc-031/SF33_PUBLISH_BLOCKER.md" "${OUT}/fixtures/"
cp -f "${ROOT}/fixtures/m11/ind-soc-031/sf33-publish-gate.json" "${OUT}/fixtures/"
cp -f "${ROOT}/fixtures/m11/ind-soc-031/PLATFORM_REUSE_GAP_LIST.md" "${OUT}/fixtures/"
cp -f "${ROOT}/fixtures/m11/ind-soc-031/POLICY_INPUT_REQUIRED.md" "${OUT}/fixtures/"

pnpm --filter @serviceform/service-templates exec vitest run \
  test/catalogue.test.ts \
  test/m11-income-dry-run-fixtures.test.ts \
  test/lab-offer-sample-data.test.ts \
  | tee "${OUT}/logs/unit-templates.log"

pnpm --filter @serviceform/web-citizen exec vitest run \
  test/m11-income-gated.test.ts \
  | tee "${OUT}/logs/unit-citizen-income-gate.log"

# Focused e2e: Residence golden + Income second-service DRAFT/DUMMY ceiling
# (Playwright still boots all web shells via playwright.config webServer).
pnpm exec playwright test -c tests/e2e/playwright.config.ts \
  tests/e2e/golden/ind-soc-002-golden.spec.ts \
  tests/e2e/m11-second-service-reuse.spec.ts \
  tests/e2e/certificate-forms-representatives.spec.ts \
  | tee "${OUT}/logs/e2e-golden2.log"

cp -f test-results/e2e/junit.xml "${OUT}/junit/e2e.xml" 2>/dev/null || true
cp -f test-results/e2e/results.json "${OUT}/junit/results.json" 2>/dev/null || true

ENDED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ENDED_IST="$(TZ=Asia/Kolkata date '+%Y-%m-%d %H:%M Asia/Calcutta')"

# Parse playwright JSON stats when present.
PASSED=0
FAILED=0
if [[ -f "${OUT}/junit/results.json" ]]; then
  PASSED="$(node -e "const j=require('${OUT}/junit/results.json'); const s=j.stats||{}; process.stdout.write(String(s.expected??s.passed??0));" 2>/dev/null || echo 0)"
  FAILED="$(node -e "const j=require('${OUT}/junit/results.json'); const s=j.stats||{}; process.stdout.write(String(s.unexpected??s.failed??0));" 2>/dev/null || echo 0)"
fi

cat >"${OUT}/summary.json" <<JSON
{
  "schema": "serviceform.p8.golden2.summary.v1",
  "commit_sha": "${TIP}",
  "started_at": "${STARTED_AT}",
  "ended_at": "${ENDED_AT}",
  "executed_at_ist": "${ENDED_IST}",
  "environment_label": "SAMPLE_LAB",
  "connectors": {
    "digilocker": "SIMULATED",
    "otp": "SIMULATED",
    "idp": "SIMULATED",
    "sms": "SIMULATED",
    "payment": "SIMULATED"
  },
  "digilocker_real_out_of_scope": true,
  "certified": false,
  "g6": false,
  "self_certified": false,
  "tsb_seal_g6": false,
  "residence_catalogue_id": "IND-SOC-002",
  "income_catalogue_id": "IND-SOC-031",
  "income_version_status": "DRAFT",
  "income_maturity": "SAMPLE_LAB_STUB",
  "sf33_income_statute": "BLOCKED",
  "publish_blocker": "SF-33",
  "statute_invented": false,
  "income_marked_published": false,
  "e2e": {
    "passed": ${PASSED},
    "failed": ${FAILED},
    "log": "logs/e2e-golden2.log",
    "junit": "junit/e2e.xml"
  },
  "unit": {
    "service_templates": { "log": "logs/unit-templates.log" },
    "web_citizen_income_gate": { "log": "logs/unit-citizen-income-gate.log" }
  },
  "fixtures": [
    "fixtures/SF33_PUBLISH_BLOCKER.md",
    "fixtures/sf33-publish-gate.json",
    "fixtures/PLATFORM_REUSE_GAP_LIST.md",
    "fixtures/POLICY_INPUT_REQUIRED.md"
  ],
  "notes": "Residence golden held. Income second-service proven at DRAFT/DUMMY lab-offer ceiling via Studio metadata only. SF-33 is the only PUBLISH blocker. No statute invented. DigiLocker REAL out of scope."
}
JSON

cat >"${OUT}/EVIDENCE.md" <<MD
# P8-6 Golden-2 — config-only second service (DRAFT/DUMMY ceiling)

**Stamp:** SAMPLE_LAB · DigiLocker **SIMULATED** (REAL **out of scope**) · **CERTIFIED=false · G6=false · self_certified=false · TSB_seal(G6)=false**  
**Tip:** \`${TIP}\`  
**Executed:** ${ENDED_IST}  
**Re-run:** \`scripts/dev/p8-golden2-evidence.sh\` (requires \`platform-lab.sh up\`)

## Mission

1. Hold **Residence Certificate (IND-SOC-002)** Golden path on Studio metadata only.
2. Prove **Income (IND-SOC-031)** second-service reuse at honest **DRAFT / SAMPLE_LAB DUMMY / lab-offer** ceiling.
3. Document **SF-33** as the **only** statutory **PUBLISH** blocker — no invented statute; Income not marked PUBLISHED.

## Executed results

| Suite | Artefact |
|---|---|
| Playwright (golden + M11/P8-6 + certificate representatives) | \`logs/e2e-golden2.log\`, \`junit/\` |
| \`@serviceform/service-templates\` catalogue + M11 dry-run + SF-33 gate | \`logs/unit-templates.log\` |
| \`@serviceform/web-citizen\` M11 Income gate | \`logs/unit-citizen-income-gate.log\` |

Stats from \`summary.json\`: e2e passed=${PASSED} failed=${FAILED}.

## SF-33 PUBLISH blocker

See \`fixtures/SF33_PUBLISH_BLOCKER.md\` and \`fixtures/sf33-publish-gate.json\`.

| Field | Value |
|---|---|
| \`statutory_publish\` | **BLOCKED** |
| \`publish_blocker\` | **SF-33** |
| \`statute_invented\` | **false** |
| \`income_marked_published\` | **false** |

## Platform reuse

See \`fixtures/PLATFORM_REUSE_GAP_LIST.md\`. No new \`services/**\` Income backend. Closed CCR-M11-001 gaps remain reusable platform capabilities.

## Honesty

- CERTIFIED=false · G6=false · self_certified=false
- DigiLocker REAL out of scope for path-to-8
- Lab-offer ≠ statutory PUBLISHED
- Agents do not self-certify; independent reviewer owns D4 7→8 GO/NO-GO
MD

echo "p8-golden2-evidence: wrote ${OUT} (tip=${TIP}, CERTIFIED=false, G6=false, SF-33=BLOCKED)"
