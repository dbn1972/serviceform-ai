#!/usr/bin/env bash
# Runs every M00 bootstrap check and writes one log per check to evidence/M00/logs/.
# Exit code is non-zero if any check fails. Optional tools (Flutter, Terraform, gitleaks,
# semgrep, checkov, actionlint, PostgreSQL) are skipped with a SKIPPED marker when absent;
# CI runs all of them.
#
# Env: DATABASE_URL (disposable PostgreSQL 16 for db tests), PW_CHROMIUM_PATH (optional),
#      GITLEAKS, ACTIONLINT, CHECKOV, TERRAFORM (paths to binaries if not on PATH).
set -uo pipefail
cd "$(dirname "$0")/.."
LOG_DIR=evidence/M00/logs
mkdir -p "$LOG_DIR"
SUMMARY="$LOG_DIR/summary.tsv"
printf 'check\tresult\tseconds\tcommand\n' > "$SUMMARY"
failures=0

run() {
  local name=$1; shift
  local cmd="$*"
  local start=$(date +%s)
  echo "== $name: $cmd"
  { echo "# $name"; echo "# command: $cmd"; echo "# commit: $(git rev-parse HEAD)"; echo "# started: $(date -u +%FT%TZ)"; echo; } > "$LOG_DIR/$name.log"
  if bash -c "$cmd" >> "$LOG_DIR/$name.log" 2>&1; then result=PASS; else result=FAIL; failures=$((failures + 1)); fi
  local secs=$(( $(date +%s) - start ))
  echo "# result: $result (${secs}s)" >> "$LOG_DIR/$name.log"
  printf '%s\t%s\t%s\t%s\n' "$name" "$result" "$secs" "$cmd" >> "$SUMMARY"
  echo "   $result (${secs}s)"
}

skip() {
  printf '%s\tSKIPPED\t0\t%s\n' "$1" "$2" >> "$SUMMARY"
  echo "== $1: SKIPPED ($2)"
}

have() { command -v "$1" >/dev/null 2>&1; }
GITLEAKS=${GITLEAKS:-gitleaks}; ACTIONLINT=${ACTIONLINT:-actionlint}; CHECKOV=${CHECKOV:-checkov}; TERRAFORM=${TERRAFORM:-terraform}

run 01-install          "pnpm install --frozen-lockfile"
run 02-format           "pnpm format:check"
run 03-lint             "pnpm lint"
run 04-typecheck        "pnpm typecheck"
run 05-unit-coverage    "pnpm test:coverage"
run 06-contracts        "pnpm contracts:validate"
run 07-dependency-rules "pnpm deps:graph"
run 08-gate-selftests   "python3 -m pytest scripts/gates/tests -q"
run 09-gates            "python3 scripts/gates/run_all.py --json test-results/gates/summary.json"
run 10-build            "NEXT_TELEMETRY_DISABLED=1 pnpm build"

if [[ -n "${DATABASE_URL:-}" ]]; then
  run 11-db-migrations-rls "pnpm db:test"
else
  skip 11-db-migrations-rls "DATABASE_URL not set"
fi

run 12-e2e-a11y         "pnpm e2e"

if have flutter; then
  run 13-flutter "cd apps/mobile && flutter pub get --enforce-lockfile && dart format --output=none --set-exit-if-changed lib test && flutter analyze && flutter test"
else
  skip 13-flutter "flutter not installed"
fi

run 14-compose-config "docker compose -f infra/local/docker-compose.yml --env-file infra/local/.env config --quiet"

if have "$TERRAFORM"; then
  run 15-terraform-fmt "$TERRAFORM fmt -check -recursive infra/terraform"
else
  skip 15-terraform-fmt "terraform not installed"
fi
if have "$ACTIONLINT"; then run 16-actionlint "$ACTIONLINT .github/workflows/*.yml"; else skip 16-actionlint "actionlint not installed"; fi
if have "$GITLEAKS"; then
  run 17-secret-scan "$GITLEAKS git . --config .gitleaks.toml --redact --no-banner --exit-code 1"
else
  skip 17-secret-scan "gitleaks not installed"
fi
if have semgrep; then
  run 18-sast-semgrep "semgrep --test tests/semgrep/ --metrics=off --disable-version-check && semgrep scan --metrics=off --disable-version-check --error --config .semgrep/ --exclude tests/semgrep"
else
  skip 18-sast-semgrep "semgrep not installed"
fi
run 19-dependency-audit "pnpm audit --prod --audit-level high"
if have "$CHECKOV"; then
  run 20-iac-scan "$CHECKOV -d . --framework terraform,github_actions,dockerfile,secrets --skip-path node_modules --skip-path apps/mobile/android --skip-path apps/mobile/ios --compact --quiet --skip-download"
else
  skip 20-iac-scan "checkov not installed"
fi

echo
column -t -s $'\t' "$SUMMARY" 2>/dev/null || cat "$SUMMARY"
echo "failures: $failures"
exit $(( failures > 0 ))
