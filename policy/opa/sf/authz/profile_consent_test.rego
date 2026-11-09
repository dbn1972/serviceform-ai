package sf.authz_test

import rego.v1

# SF-M10-B-2d: citizen use of CMP-005 (own CITIZEN_PRIVATE profile) and CMP-030 (own consent,
# published purposes) on the portal path, plus the host's consent-gate and privacy-publisher
# workloads. CITIZEN_PRIVATE keeps the tenant boundary of TENANT_SCOPED.

GATE := "6e6e6e6e-6e6e-46e6-86e6-6e6e6e6e6e6e"

profile_input := {
	"subject": {
		"user_id": CITIZEN_A,
		"actor_type": "CITIZEN",
		"tenant_id": T1,
		"roles": [],
		"jurisdiction_ids": [],
		"assurance": "OTP",
	},
	"resource": {
		"resource_type": "CitizenProfile",
		"tenant_id": T1,
		"classification": "CITIZEN_PRIVATE",
		"owner_id": CITIZEN_A,
	},
	"action": "PROFILE_READ",
	"environment": {"request_time": "2026-11-09T10:00:00Z"},
}

consent_input := json.patch(profile_input, [
	{"op": "replace", "path": "/resource/resource_type", "value": "Consent"},
	{"op": "replace", "path": "/resource/classification", "value": "TENANT_SCOPED"},
	{"op": "replace", "path": "/action", "value": "CONSENT_GRANT"},
])

gate_role := {T1: {"roles": {"CONSENT_GATE": {
	"actions": ["PRIVACY_ACCESS_CHECK"],
	"resource_types": ["Consent"],
	"jurisdiction_scope": "TENANT_WIDE",
	"all_services": true,
}}}}

gate_input := {
	"subject": {
		"user_id": GATE,
		"actor_type": "SYSTEM",
		"tenant_id": T1,
		"roles": ["CONSENT_GATE"],
		"jurisdiction_ids": [],
		"assurance": "WORKLOAD_IDENTITY",
	},
	"resource": {
		"resource_type": "Consent",
		"tenant_id": T1,
		"classification": "TENANT_SCOPED",
		"owner_id": CITIZEN_A,
	},
	"action": "PRIVACY_ACCESS_CHECK",
	"environment": {"request_time": "2026-11-09T10:00:00Z"},
}

test_citizen_reads_and_writes_own_profile if {
	every action in ["PROFILE_READ", "PROFILE_WRITE"] {
		d := eval(with_action(profile_input, action), {})
		d.allow == true
		d.policy_revision == "m10-b2d"
	}
}

test_citizen_profile_of_another_citizen_denied if {
	inp := json.patch(profile_input, [{"op": "replace", "path": "/resource/owner_id", "value": CITIZEN_B}])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "ROLE_NOT_PERMITTED"
}

test_citizen_profile_without_owner_denied if {
	inp := json.patch(profile_input, [{"op": "remove", "path": "/resource/owner_id"}])
	eval(inp, {}).allow == false
}

test_citizen_verified_import_not_granted if {
	d := eval(with_action(profile_input, "PROFILE_IMPORT_VERIFIED"), {})
	d.allow == false
	d.reason_code == "ROLE_NOT_PERMITTED"
}

test_citizen_private_cross_tenant_denied if {
	inp := json.patch(profile_input, [{"op": "replace", "path": "/resource/tenant_id", "value": T2}])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "TENANT_MISMATCH"
}

test_citizen_private_null_tenant_denied if {
	no_subject := json.patch(profile_input, [{"op": "replace", "path": "/subject/tenant_id", "value": null}])
	eval(no_subject, {}).reason_code == "TENANT_MISMATCH"
	no_resource := json.patch(profile_input, [{"op": "replace", "path": "/resource/tenant_id", "value": null}])
	eval(no_resource, {}).reason_code == "TENANT_MISMATCH"
}

test_citizen_private_unonboarded_tenant_denied if {
	other := "99999999-0000-4000-8000-999999999999"
	inp := json.patch(profile_input, [
		{"op": "replace", "path": "/subject/tenant_id", "value": other},
		{"op": "replace", "path": "/resource/tenant_id", "value": other},
	])
	eval(inp, {}).reason_code == "POLICY_DATA_MISSING"
}

test_citizen_profile_needs_otp_or_mfa if {
	inp := json.patch(profile_input, [{"op": "remove", "path": "/subject/assurance"}])
	eval(inp, {}).allow == false
}

test_citizen_profile_with_roles_denied if {
	inp := json.patch(profile_input, [{"op": "replace", "path": "/subject/roles", "value": ["ROLE_A"]}])
	eval(inp, {}).reason_code == "CITIZEN_ROLES_FORBIDDEN"
}

test_citizen_grants_and_reads_own_consent if {
	every action in ["CONSENT_GRANT", "CONSENT_READ"] {
		eval(with_action(consent_input, action), {}).allow == true
	}
}

test_citizen_consent_for_another_subject_denied if {
	inp := json.patch(consent_input, [{"op": "replace", "path": "/resource/owner_id", "value": CITIZEN_B}])
	eval(inp, {}).allow == false
}

test_citizen_cannot_withdraw_or_access_check if {
	every action in ["CONSENT_WITHDRAW", "PRIVACY_ACCESS_CHECK"] {
		eval(with_action(consent_input, action), {}).allow == false
	}
}

test_citizen_reads_published_purposes_only if {
	read := json.patch(consent_input, [
		{"op": "replace", "path": "/resource/resource_type", "value": "Purpose"},
		{"op": "remove", "path": "/resource/owner_id"},
		{"op": "replace", "path": "/action", "value": "PURPOSE_READ"},
	])
	eval(read, {}).allow == true
	eval(with_action(read, "PURPOSE_CREATE"), {}).allow == false
	notice := json.patch(read, [
		{"op": "replace", "path": "/resource/resource_type", "value": "PrivacyNotice"},
		{"op": "replace", "path": "/action", "value": "NOTICE_PUBLISH"},
	])
	eval(notice, {}).allow == false
}

test_consent_gate_workload_checks_access if {
	eval(gate_input, gate_role).allow == true
}

test_consent_gate_role_is_check_only if {
	every action in ["CONSENT_GRANT", "CONSENT_READ", "CONSENT_WITHDRAW"] {
		eval(with_action(gate_input, action), gate_role).allow == false
	}
	profile := json.patch(gate_input, [
		{"op": "replace", "path": "/resource/resource_type", "value": "CitizenProfile"},
		{"op": "replace", "path": "/resource/classification", "value": "CITIZEN_PRIVATE"},
		{"op": "replace", "path": "/action", "value": "PROFILE_READ"},
	])
	eval(profile, gate_role).allow == false
}

test_consent_gate_other_tenant_denied if {
	inp := json.patch(gate_input, [{"op": "replace", "path": "/resource/tenant_id", "value": T2}])
	eval(inp, gate_role).reason_code == "TENANT_MISMATCH"
}
