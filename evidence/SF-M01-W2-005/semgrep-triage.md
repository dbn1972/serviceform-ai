# SF-M01-W2-005 Semgrep triage (CI run 37168017453)

| Field | Value |
|---|---|
| CI run | https://github.com/dbn1972/serviceform-ai/actions/runs/37168017453 |
| Findings before fix | 3 blocking |
| Thresholds weakened | none |
| Frozen contracts edited | none |

## Findings

### 1. `semgrep.sf-no-console-log` — TRUE_POSITIVE
- Files: `src/cli/lint-contracts.ts`, `src/cli/write-evidence-manifest.ts`
- Fix: replace `console.log` with `process.stdout.write` (CLI status only; errors stay on `console.error`)

### 2. `ajinabraham.njsscan.dos.regex_dos.regex_dos` — TRUE_POSITIVE (defensive)
- File: `src/provenance.ts` (git SHA pattern)
- Fix: fixed-length hex validation via charCode loop (no quantifier regex)

Also addressed ESLint `no-console` / `no-non-null-assertion` on the same CLI/parser paths.
