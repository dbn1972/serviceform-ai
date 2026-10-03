#!/usr/bin/env bash
# Generates infra/local/.env with random, local-only credentials. Never commit the result.
set -euo pipefail
cd "$(dirname "$0")/../.."
out=infra/local/.env
if [[ -f "$out" ]]; then
  echo "$out already exists; delete it to regenerate." >&2
  exit 0
fi
rand() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32; }
umask 077
cat >"$out" <<ENV
SF_LOCAL_PG_USER=serviceform
SF_LOCAL_PG_PASSWORD=$(rand)
SF_LOCAL_REDIS_PASSWORD=$(rand)
SF_LOCAL_AWS_REGION=us-east-1
ENV
echo "wrote $out"
