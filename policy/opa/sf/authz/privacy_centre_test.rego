package sf.authz_test

import rego.v1

# SAMPLE_LAB privacy centre (CMP-061): citizen owner grants for me/request; withdraw via
# privacy request only (CONSENT_WITHDRAW remains denied — profile_consent_test). Fail-closed.

CITIZEN_PRIV := "22222222-2222-4222-8222-222222222222"
CITIZEN_OTHER := "33333333-3333-4333-8333-333333333333"

privacy_me_input := {
	"subject": {
		"user_id": CITIZEN_PRIV,
		"actor_type": "CITIZEN",
		"tenant_id": T1,
		"roles": [],
		"jurisdiction_ids": [],
		"assurance": "OTP",
	},
	"resource": {
		"resource_type": "PrivacyCentre",
		"tenant_id": T1,
		"classification": "TENANT_SCOPED",
		"owner_id": CITIZEN_PRIV,
	},
	"action": "PRIVACY_ME_READ",
	"environment": {"request_time": "2026-11-22T10:00:00Z"},
}

privacy_request_input := json.patch(privacy_me_input, [
	{"op": "replace", "path": "/resource/resource_type", "value": "PrivacyRequest"},
	{"op": "replace", "path": "/action", "value": "PRIVACY_REQUEST_SUBMIT"},
])

test_citizen_reads_privacy_centre_me if {
	eval(privacy_me_input, {}).allow == true
}

test_citizen_submits_reads_withdraws_own_privacy_request if {
	every action in ["PRIVACY_REQUEST_SUBMIT", "PRIVACY_REQUEST_READ", "PRIVACY_REQUEST_WITHDRAW"] {
		eval(with_action(privacy_request_input, action), {}).allow == true
	}
}

test_citizen_privacy_for_another_subject_denied if {
	inp := json.patch(privacy_me_input, [{"op": "replace", "path": "/resource/owner_id", "value": CITIZEN_OTHER}])
	eval(inp, {}).allow == false
}

test_citizen_cannot_deny_or_complete_privacy_request if {
	every action in [
		"PRIVACY_REQUEST_DENY",
		"PRIVACY_REQUEST_COMPLETE",
		"PRIVACY_TASKS_REQUEST",
		"PRIVACY_TASK_OUTCOME",
	] {
		eval(with_action(privacy_request_input, action), {}).allow == false
	}
}

test_citizen_privacy_without_owner_id_denied if {
	inp := json.patch(privacy_me_input, [{"op": "remove", "path": "/resource/owner_id"}])
	eval(inp, {}).allow == false
}

test_citizen_privacy_needs_otp_or_mfa if {
	inp := json.patch(privacy_me_input, [{"op": "remove", "path": "/subject/assurance"}])
	eval(inp, {}).allow == false
}

test_privacy_actions_are_known if {
	every action in [
		"PRIVACY_ME_READ",
		"PRIVACY_REQUEST_SUBMIT",
		"PRIVACY_REQUEST_READ",
		"PRIVACY_REQUEST_WITHDRAW",
		"PRIVACY_REQUEST_DENY",
		"PRIVACY_TASKS_REQUEST",
		"PRIVACY_TASK_OUTCOME",
		"PRIVACY_REQUEST_COMPLETE",
	] {
		data.sf.common.actions[action]
	}
}

test_privacy_resource_types_registered if {
	"PrivacyCentre" in data.sf.common.resource_types
	"PrivacyRequest" in data.sf.common.resource_types
	"PrivacyFulfilmentTask" in data.sf.common.resource_types
}
