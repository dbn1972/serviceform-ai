#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OPA="${OPA_BIN:-opa}"
cd "$ROOT"
"$OPA" check --strict policy/opa
"$OPA" fmt --fail --list policy/opa
"$OPA" test -v --coverage policy/opa
# system/authz is server authorization, not a bundle root (manifest roots: sf, system/log).
# opa --ignore matches file/directory names only, so exclude the tree before build.
bundle_src="$(mktemp -d)"
cp -a policy/opa/. "$bundle_src/"
rm -rf "$bundle_src/system/authz"
find "$bundle_src" -name '*_test.rego' -delete
"$OPA" build -b "$bundle_src" --revision "${1:-w1-cmp048}" -o /tmp/sf-cmp048-opa.tar.gz
rm -rf "$bundle_src"
# Mutation: emptying tenant helper must fail at least one test.
tmp="$(mktemp -d)"
cp -R policy/opa/. "$tmp/"
printf 'package sf.authz\nimport rego.v1\n' > "$tmp/sf/authz/tenant.rego"
if "$OPA" test "$tmp" >/dev/null 2>&1; then
  echo "mutation check failed: tenant.rego body deletion did not break tests" >&2
  exit 1
fi
echo "mutation-check: tenant.rego deletion fails tests (expected)"
