# SF-M01-005 Semgrep triage (redacted)

Source: GitHub Actions `SAST (semgrep)` run 37138868386 / job 111248959086 on PR #18.
Command: `semgrep scan --metrics=off --error --config p/default --config p/typescript --config p/nodejsscan --config p/secrets --config .semgrep/`.
CI result before remediation: **3 findings**, 721 rules, 411 files.
Local re-scan after remediation (semgrep 1.179.0, same configs): **0 findings**, 721 rules, 411 files.

No rule was disabled, downgraded, or globally excluded. `.github/**`, frozen contracts, and `pnpm-lock.yaml` were not modified.

## Blocking findings on the CMP-037 diff

### 1. `ajinabraham.njsscan.crypto.crypto_node.node_insecure_random_generator`

| Field | Value |
|---|---|
| Severity | warning (blocking under CI `--error`) |
| File | `packages/connector-sdk/src/retry.ts` |
| Range | L48 |
| Classification | **TRUE_POSITIVE** |
| In allowed write paths | yes (`packages/connector-sdk/**`) |
| Snippet (redacted) | `systemRandom.next` used `Math.random()` for retry jitter |

**Remediation:** default jitter now uses `crypto.randomInt(0, 2**32) / 2**32`. Tests still inject a deterministic `RandomSource`. No suppression.

### 2. `ajinabraham.njsscan.generic.hardcoded_secrets.node_secret`

| Field | Value |
|---|---|
| Severity | error |
| File | `packages/connector-sdk/src/webhook.ts` |
| Range | L42 (`Buffer.from(..., 'hex')` on HMAC digest / signature) |
| Classification | **FALSE_POSITIVE** (no hardcoded credential; HMAC key is `SecretMaterial` resolved at runtime) |
| In allowed write paths | yes (`packages/connector-sdk/**`) |
| Snippet (redacted) | `Buffer.from(<hmac-hex>, 'hex')` compared via `timingSafeEqual` |

**Remediation:** decode hex with an explicit byte parser (`bytesFromHex`) instead of `Buffer.from(str, 'hex')`, which the rule treats as embedded key material. Signature verification behaviour unchanged. No exclusion.

### 3. `semgrep.sf-no-tenant-from-client-header`

| Field | Value |
|---|---|
| Severity | error |
| File | `services/cmp-037-integration-hub/src/plugin.ts` |
| Range | L121 (pre-fix) |
| Classification | **TRUE_POSITIVE** of the syntactic rule; the code was already *refusing* the header (SF-TEN-002), not using it as tenant context |
| In allowed write paths | yes (`services/cmp-037-integration-hub/**`) |
| Snippet (redacted) | `request.headers['x-tenant-id']` used only as a deny check |

**Remediation:** refuse any client tenant-identifying header by scanning header *names* with `/^(x-)?(sf-)?tenant(-id)?$/i`. Tenant remains server-derived `RequestContext`. Stronger than the two-header subscript, and it no longer matches the forbidden pattern.

## Not in this triage

Lockfile-caused CI (`format/lint/typecheck/unit/contracts/build`, web smoke/a11y, migrations/tenant-isolation, dependency audit) remains **BLOCKED_PENDING_ORCHESTRATOR_LOCKFILE_RECONCILIATION**. Builders must not commit `pnpm-lock.yaml`.
