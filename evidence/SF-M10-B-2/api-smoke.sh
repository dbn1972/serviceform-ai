#!/usr/bin/env bash
# SF-M10-B-2 API smoke against the SAMPLE_LAB platform host (scripts/dev/platform-lab.sh up).
# Builder evidence only; independent INT/SEC verification is separate. Synthetic data only.
set -euo pipefail
A="${SF_API_BASE_URL:-http://127.0.0.1:4000}"
TSB=0d15ba00-0002-4000-8000-0d15ba0000d2
FORM=0d15ba00-0010-4000-8000-0d15ba000010
uuid() { python3 -c 'import uuid;print(uuid.uuid4())'; }
field() { python3 -c "import json,sys;print(json.load(sys.stdin)$1)"; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

citizen() {
  local cid code
  cid=$(curl -s -X POST "$A/v1/identity/citizen/otp/challenges" -H 'content-type: application/json' \
    -H "idempotency-key: $(uuid)" -d "{\"channel\":\"$1\"}" | field '["challenge_id"]')
  code=$(curl -s "$A/v1/simulated/otp-inbox/$cid" | field '["code"]')
  curl -s -X POST "$A/v1/identity/citizen/otp/verify" -H 'content-type: application/json' \
    -d "{\"challenge_id\":\"$cid\",\"code\":\"$code\"}" | field '["session_token"]'
}

cmd() {
  curl -s -X POST "$A/v1/applications/$APP/commands" -H 'content-type: application/json' \
    -H "authorization: Bearer $1" -H "idempotency-key: k-$(uuid)" -d "$2" |
    python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('application',{}).get('state') or d.get('error_code'), d.get('details',''))"
}

C1=$(citizen +919000000101)
C2=$(citizen +919000000102)
APP=$(curl -s -X POST "$A/v1/applications" -H 'content-type: application/json' -H "authorization: Bearer $C1" \
  -H "idempotency-key: k-$(uuid)" -d "{\"tenant_service_binding_id\":\"$TSB\"}" | field '["application"]["application_id"]')
echo "draft created by citizen 1: yes"
echo "working data write (owner): $(status -X PUT "$A/v1/applications/$APP/working-data" -H 'content-type: application/json' \
  -H "authorization: Bearer $C1" -H "idempotency-key: k-$(uuid)" \
  -d "{\"form_version_id\":\"$FORM\",\"data\":{\"applicant_name\":\"SAMPLE Smoke\"},\"expected_revision\":0}")"
echo "citizen 2 GET citizen 1 case (expect 403): $(status "$A/v1/applications/$APP" -H "authorization: Bearer $C2")"
echo "citizen 2 GET citizen 1 working data (expect 403): $(status "$A/v1/applications/$APP/working-data" -H "authorization: Bearer $C2")"
echo "citizen 2 list size (expect 0): $(curl -s "$A/v1/applications" -H "authorization: Bearer $C2" | field '["applications"].__len__()')"
echo "forged bearer (expect 401): $(status "$A/v1/applications" -H 'authorization: Bearer forged-token-forged-token-forged-token-x')"
echo "tenant header (expect 403): $(status "$A/v1/applications" -H "authorization: Bearer $C1" -H 'x-tenant-id: 22222222-2222-4222-8222-222222222222')"
echo "citizen MARK_RECEIVED (expect SF-AUTH-002): $(cmd "$C1" '{"command":"MARK_RECEIVED","expected_state":"DRAFT","expected_version":1}')"
echo "citizen MARK_READY_TO_SUBMIT: $(cmd "$C1" '{"command":"MARK_READY_TO_SUBMIT","expected_state":"DRAFT","expected_version":1}')"
echo "citizen SUBMIT: $(cmd "$C1" '{"command":"SUBMIT","expected_state":"READY_TO_SUBMIT","expected_version":2}')"
AS=$(curl -s -X POST "$A/v1/simulated/idp/assertions" -H 'content-type: application/json' -d '{"subject":"sample-lab-case-officer-1"}' | field '["assertion"]')
O=$(curl -s -X POST "$A/v1/identity/officer/sessions" -H 'content-type: application/json' -H "idempotency-key: $(uuid)" \
  -d "{\"assertion\":\"$AS\"}" | field '["session_token"]')
echo "unknown IdP subject (expect 401): $(status -X POST "$A/v1/simulated/idp/assertions" -H 'content-type: application/json' -d '{"subject":"nobody"}')"
echo "officer MARK_RECEIVED: $(cmd "$O" '{"command":"MARK_RECEIVED","expected_state":"SUBMITTED","expected_version":3}')"
echo "officer ENTER_SCRUTINY: $(cmd "$O" '{"command":"ENTER_SCRUTINY","expected_state":"RECEIVED","expected_version":4}')"
echo "officer ENTER_DECISION_PENDING: $(cmd "$O" '{"command":"ENTER_DECISION_PENDING","expected_state":"UNDER_SCRUTINY","expected_version":5}')"
echo "AI final decision (expect refusal): $(cmd "$O" '{"command":"RECORD_APPROVED","expected_state":"DECISION_PENDING","expected_version":6,"decision":{"decision_maker":"AI"}}')"
echo "HUMAN decision: $(cmd "$O" '{"command":"RECORD_APPROVED","expected_state":"DECISION_PENDING","expected_version":6,"decision":{"decision_maker":"HUMAN"}}')"
echo "transitions (command, actor_type, policy_revision):"
curl -s "$A/v1/applications/$APP/transitions" -H "authorization: Bearer $C1" |
  python3 -c "import json,sys;[print('  ',t['command'],t['actor_type'],t['authz_policy_revision']) for t in json.load(sys.stdin)['transitions']]"
echo "citizen 1 revoke then reuse (expect 401): $(status -X POST "$A/v1/identity/citizen/sessions/revoke" -H 'content-type: application/json' -H "authorization: Bearer $C1" -d '{}' >/dev/null; status "$A/v1/applications" -H "authorization: Bearer $C1")"
