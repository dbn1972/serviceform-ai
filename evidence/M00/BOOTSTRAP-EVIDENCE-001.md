# BOOTSTRAP-EVIDENCE-001: M00 repository and engineering foundation

| Field | Value |
|---|---|
| Module | M00 Architecture Verification and Repository Bootstrap (`specs/build-plan.yaml`) |
| Task | `prompts/01_REPOSITORY_BOOTSTRAP.md` |
| Requirement sources | AWS v1.7 §2, §5, §13, §14, §17 (M0), §17.2, §20.3; Eng v1.4 §9, §10, §20.3; TI v1.0 §6–§8; Constitution #3, #6, #21–#28; DESIGN-SYSTEM.md; SECURITY.md; TESTING.md; ci/ARCHITECTURE-GATES.md |
| Source commit | `851083671adcb7b5296881395c29f4d244dc91e0` (branch `main`, local only, not pushed) |
| Environment | CI-equivalent local run in a Linux cloud container, 3 Oct 2026 (UTC). No Docker daemon, no GitHub Actions run yet. |
| Connector modes | None exercised (no connectors exist in M00). SIMULATED is enforced for LOCAL/CI by the connector-binding contract. |
| Command | `bash scripts/bootstrap-check.sh` with `DATABASE_URL` set to a disposable local PostgreSQL 16.14 |
| Run summary | `evidence/M00/logs/summary.tsv` (one log per check in `evidence/M00/logs/`) |
| Result | **20 of 20 checks PASS, 0 skipped** |
| Recommended gate status | **G1_BUILD_READY recommended, not certified.** Builder-produced evidence; needs an independent verifier and the human approver (Constitution #27, #28). |
| Produced by | Claude (single session, builder role). Not reviewed by an independent verifier yet. |

## 1. Check results

| # | Check | Result | What it proves |
|---|---|---|---|
| 01 | `pnpm install --frozen-lockfile` | PASS | Lockfile is complete and reproducible |
| 02 | `pnpm format:check` | PASS | Prettier clean |
| 03 | `pnpm lint` (max warnings 0) | PASS | ESLint strict TS + security plugin + Next rules, SQL interpolation ban |
| 04 | `pnpm typecheck` | PASS | 9 workspaces, TypeScript 6.0.3 strict (noUncheckedIndexedAccess, exactOptionalPropertyTypes) |
| 05 | `pnpm test:coverage` | PASS | 30 unit/component tests in 6 files; coverage lines 95.7 %, statements 93.8 %, functions 91.1 %, branches 82.8 % (thresholds 80/80/80/70) |
| 06 | `pnpm contracts:validate` | PASS | 10 shared contracts compile in Ajv strict mode; 11 valid examples accepted, 8 invalid examples rejected |
| 07 | `pnpm deps:graph` | PASS | 66 modules, 75 dependencies, no violations of the 6 dependency rules |
| 08 | gate self-tests (pytest) | PASS | 14 tests: every gate fails on the violation it exists for |
| 09 | architecture gates | PASS | 7/7 gates pass; 6 warnings are the known build-plan findings (§4) |
| 10 | `pnpm build` | PASS | API bundle (declared-dependency check) and 4 Next.js production builds |
| 11 | `pnpm db:test` | PASS | 9 tests: migrations apply from empty, roll back fully, re-apply, idempotent; `sf_app` has no BYPASSRLS; RLS harness proves tenant scoping, fail-closed without context, cross-tenant insert refused, IDOR read returns nothing |
| 12 | `pnpm e2e` | PASS | 20 Playwright tests (4 shells x 5): landmarks + h1, axe WCAG 2.1 A/AA zero violations, skip link keyboard path, 320 px reflow, security headers + health |
| 13 | Flutter format/analyze/test | PASS | `flutter analyze` clean; 2 widget tests incl. text-contrast and tap-target guidelines |
| 14 | `docker compose config` | PASS | Local infrastructure definition is valid (10 services) |
| 15 | `terraform fmt -check` | PASS | IaC skeleton formatted |
| 16 | actionlint 1.7.12 | PASS | Both workflows lint clean |
| 17 | gitleaks 8.30.1 (git history) | PASS | 5 commits scanned, no leaks |
| 18 | Semgrep 1.179.0 | PASS | 3/3 rule self-tests; 4 repository rules, 51 targets, 0 findings |
| 19 | `pnpm audit --prod --audit-level high` | PASS | No known vulnerabilities in runtime dependencies |
| 20 | Checkov 3.3.22 | PASS | Terraform 1/1, GitHub Actions 324/324, secrets 0 findings |

Additional executed evidence in `evidence/M00/artifacts/`:

- `api-built-server-smoke.txt`: the bundled API (`node dist/server.js`) answering `/health/live`, `/v1/meta`, `/health/ready` and an unknown route with a contract-valid `SF-SYS-002` body and the caller's correlation id; graceful SIGTERM shutdown in the log. Captured before two hardening edits (strict API CSP, `X-Frame-Options: DENY`), which unit tests 05 cover.
- `dependency-rules-negative-probe.txt`: dependency-cruiser rejecting a temporary cross-component import (`services/cmp-901 -> services/cmp-902`); the probe files were removed afterwards.
- `unit-junit.xml`, `e2e-junit.xml`, `coverage-summary.json`, `gates-summary.json`, `dependency-audit-all.txt`.

Defects the checks caught during the bootstrap and that were fixed before this run:
the Flutter shell failed the WCAG text-contrast guideline (no background painted); the committed
Flutter lockfile was stale (`--enforce-lockfile` failed, fixed in `8510836`); the Next.js shells
could not resolve the wrapper under Turbopack; the API bundle missed transitive runtime
dependencies (the build now fails on any undeclared one); request logs carried client IP
addresses (now redacted, with a test).

## 2. Deliverables against prompt 01 and AWS v1.7 §17 M0

| Deliverable | Where | Status |
|---|---|---|
| Monorepo, package management | `pnpm-workspace.yaml`, `package.json` (pnpm 10.28, Node 22 LTS, exact pins) | Done |
| TypeScript standards | `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`, `.editorconfig` | Done |
| Fastify application foundation | `apps/api` (config, probes, error envelope, correlation, helmet, under-pressure, graceful shutdown) | Done, no business routes |
| Next.js application shells | `apps/web-citizen`, `web-officer`, `web-studio`, `web-admin` | Done (structure only, see G-03) |
| Flutter project foundation | `apps/mobile` | Done (structure only, see G-03) |
| Shared contracts | `contracts/shared`, `packages/contracts`, `orchestrator/contracts-lock.yaml` | Done, status DRAFT (G-05) |
| Database migration framework | `db/` (node-pg-migrate SQL), platform baseline migration | Done |
| Test framework | Vitest (unit/component, coverage), DB integration suite, Playwright + axe, Flutter test, pytest for gates | Done |
| CI/CD skeleton | `.github/workflows/ci.yml`, `security.yml`, Dependabot, PR template | Written and linted; not yet run on GitHub (G-01) |
| Local development infrastructure | `infra/local/docker-compose.yml`, `scripts/dev/init-local-env.sh` | Valid; not started here (G-02) |
| Observability foundation | `packages/observability` (redacting logger, OTel SDK), collector config | Done |
| Security scanning | gitleaks, Semgrep (+ repo rules), CodeQL, pnpm audit, SBOM, Checkov | Done (CodeQL/registry packs CI-only) |
| Architecture gates | `scripts/gates/` (7 gates + scope check), `.dependency-cruiser.cjs`, `scripts/validate_specs.py` | Done |
| IaC skeleton | `infra/terraform` | Done, no resources |
| AGENTS / Cursor / Copilot rules stay active | `agent_rules_gate.py` | Enforced |
| CODEOWNERS | `.github/CODEOWNERS` | Done (placeholder owner, G-08) |
| Business components | none | Not started, as instructed |

## 3. Architecture compliance notes (self-review, not verification)

- No tenant, jurisdiction or service logic exists yet; the jurisdiction hard-coding gate scans
  44 source files clean (Constitution #3).
- Migrations: every table must declare an isolation class, tenant/jurisdiction tables need
  `tenant_id uuid NOT NULL`, ENABLE + FORCE RLS and a policy; BYPASSRLS and RLS removal refused
  (Constitution #6, #24; TI v1.0 §8.1). Baseline creates no business tables.
- No secrets in the repository: local credentials are generated into a gitignored file; config
  has no secret defaults; connector bindings hold secret references only (Constitution #21, #22).
- UI dependencies: no second design system; colours only in the wrapper token files.
- Components may not import each other (dependency-cruiser), enforcing Constitution #23 in code.

## 4. Open items and gaps

| ID | Gap | Impact | Owner action |
|---|---|---|---|
| G-01 | GitHub Actions have not run (repository not pushed). CodeQL, Semgrep registry packs (semgrep.dev unreachable here), `terraform validate` (Terraform registry unreachable here), Docker-based steps and SBOM run only in CI. | First CI run may surface findings. | Push, run CI, attach run IDs to this record; set the CI and security jobs as required checks. |
| G-02 | No Docker daemon here, so the Compose stack was validated but not started. DB tests used a local PostgreSQL 16.14 binary. | Service start-up and health of Redis, OpenSearch, Kafka, Temporal, OPA, collector unproven. | `docker compose up` locally or in CI. |
| G-03 | UX4G 3.0 is not on the public npm registry (`ux4g`, `@ux4g/*` 404). The React and Flutter wrappers carry structure and semantics only, with neutral placeholder tokens. | UX4G conformance cannot be evidenced yet. | Supply the official UX4G 3.0 React/Flutter packages or assets and licence terms; vendor them in M03. |
| G-04 | Next.js CSP allows inline scripts (hydration). | Weaker XSS defence on web surfaces. | Nonce-based CSP with the M03 UX foundation. |
| G-05 | Shared contracts are DRAFT. Field casing follows AWS v1.7 §13.2 (snake_case) per proposed ADR-0002; `SF-SYS-*` codes are proposed additions. | Builders must not treat them as frozen. | Contract Guardian review, accept ADR-0002, set FROZEN in the lock before M01 dispatch. |
| G-06 | ADR-0001 is PROPOSED, so `specs/build-plan.yaml` (with CMP-027/032 unowned, CMP-052 and INT-013 double-owned) is still in force. New finding from the validator: **M11 has no exit gate in either plan.** | M01 dispatch stays blocked (ARCHITECTURE-VERIFICATION-001 condition 2). | Accept or amend ADR-0001, adding an exit gate for M11. |
| G-07 | One high advisory in a dev-only dependency: `braces` (GHSA-vfj7-8cjw-p6xm) via `@next/eslint-plugin-next > fast-glob > micromatch`; no patched version published. | None at runtime; lint tooling only. | Track via Dependabot; runtime audit is clean. |
| G-08 | CODEOWNERS names `@dbn1972` for every protected path; branch protection does not exist until the repository is on GitHub. | No separation of duties yet. | Replace with role teams; enable branch protection with required checks and code-owner review. |
| G-09 | Workflow actions are pinned by version tag, not commit SHA. | Supply-chain hardening. | Pin to SHAs on first push (Dependabot keeps them current). |
| G-10 | Access logs include the request path and query string. | Query parameters could carry personal data. | API gateway (CMP-036, M01) strips or allowlists query parameters in logs. |
| G-11 | Primary/DR AWS region, RPO/RTO and Terraform state backend undecided (ARCHITECTURE-VERIFICATION-001 M-09). | No deployable infrastructure. | Owner decision before infrastructure modules. |
| G-12 | Android/iOS builds not executed (no platform SDKs here); Flutter analyze and tests only. | Mobile build pipeline unproven. | Add platform build jobs when the mobile app gains features. |
| G-13 | ESLint 9 is marked deprecated upstream (ESLint 10 available); kept on 9 for Next.js plugin compatibility. | None now. | Upgrade when `@next/eslint-plugin-next` supports 10. |

## 5. Toolchain

Node 22.22.0, pnpm 10.28.0, TypeScript 6.0.3, Fastify 5.12.5, Next.js 16.3.8, React 19.3.0,
Vitest 5.0.3, ESLint 9.39.5, Playwright 1.63.0 (Chromium build 1194), axe-core/playwright 4.13.0,
node-pg-migrate 9.0.0, PostgreSQL 16.14, Flutter 3.47.6 / Dart 3.13.5, Python 3.11.15,
Terraform 1.16.5, gitleaks 8.30.1, Semgrep 1.179.0, Checkov 3.3.22, actionlint 1.7.12.

## 6. Not done, by instruction

M01 has not been started. No business component, tenant model, authentication, OPA policy,
GoRules decision or Temporal workflow was implemented. Nothing was pushed to GitHub.
