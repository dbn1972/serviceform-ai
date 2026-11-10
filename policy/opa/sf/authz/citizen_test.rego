package sf.authz_test

import data.sf.authz
import rego.v1

CITIZEN_A := "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1"

CITIZEN_B := "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2"

APP := "a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9"

citizen_input := {
	"subject": {
		"user_id": CITIZEN_A,
		"actor_type": "CITIZEN",
		"tenant_id": T1,
		"roles": [],
		"jurisdiction_ids": [],
		"assurance": "OTP",
	},
	"resource": {
		"resource_type": "ApplicationCase",
		"tenant_id": T1,
		"classification": "TENANT_SCOPED",
		"application_id": APP,
		"owner_id": CITIZEN_A,
		"service_id": SVC,
	},
	"action": "APPLICATION_READ",
	"environment": {"request_time": "2026-11-04T10:00:00Z"},
}

case_officer_role := {T1: {"roles": {"CASE_OFFICER": {
	"actions": ["APPLICATION_READ", "APPLICATION_LIST", "APPLICATION_RECORD_APPROVED"],
	"resource_types": ["ApplicationCase"],
	"jurisdiction_scope": "TENANT_WIDE",
	"all_services": true,
}}}}

officer_input := json.patch(citizen_input, [
	{"op": "replace", "path": "/subject/actor_type", "value": "OFFICER"},
	{"op": "replace", "path": "/subject/user_id", "value": U1},
	{"op": "replace", "path": "/subject/roles", "value": ["CASE_OFFICER"]},
	{"op": "replace", "path": "/subject/assurance", "value": "MFA"},
	{"op": "replace", "path": "/action", "value": "APPLICATION_RECORD_APPROVED"},
])

with_action(inp, action) := json.patch(inp, [{"op": "replace", "path": "/action", "value": action}])

test_citizen_owner_read_allowed if {
	d := eval(citizen_input, {})
	d.allow == true
	d.reason_code == "ALLOW"
	d.policy_revision == "m10-c3"
}

test_citizen_owner_journey_actions_allowed if {
	every action in [
		"APPLICATION_CREATE_DRAFT",
		"APPLICATION_LIST",
		"APPLICATION_WORKING_DATA_WRITE",
		"APPLICATION_WORKING_DATA_READ",
		"APPLICATION_MARK_READY_TO_SUBMIT",
		"APPLICATION_SUBMIT",
		"APPLICATION_TRANSITIONS_READ",
	] {
		eval(with_action(citizen_input, action), {}).allow == true
	}
}

test_citizen_non_owner_denied if {
	inp := json.patch(citizen_input, [{"op": "replace", "path": "/subject/user_id", "value": CITIZEN_B}])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "ROLE_NOT_PERMITTED"
}

test_citizen_missing_owner_denied if {
	inp := json.patch(citizen_input, [{"op": "remove", "path": "/resource/owner_id"}])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "ROLE_NOT_PERMITTED"
}

test_citizen_empty_or_non_string_owner_denied if {
	every owner in ["", 42, null, [CITIZEN_A]] {
		inp := json.patch(citizen_input, [{"op": "replace", "path": "/resource/owner_id", "value": owner}])
		eval(inp, {}).allow == false
	}
}

test_citizen_presenting_roles_denied if {
	inp := json.patch(citizen_input, [{"op": "replace", "path": "/subject/roles", "value": ["CASE_OFFICER"]}])
	d := eval(inp, case_officer_role)
	d.allow == false
	d.reason_code == "CITIZEN_ROLES_FORBIDDEN"
}

test_citizen_without_assurance_denied if {
	every assurance in ["NONE", "", "WORKLOAD_IDENTITY"] {
		inp := json.patch(citizen_input, [{"op": "replace", "path": "/subject/assurance", "value": assurance}])
		eval(inp, {}).allow == false
	}
}

test_citizen_cannot_take_officer_decisions if {
	every action in [
		"APPLICATION_RECORD_APPROVED",
		"APPLICATION_RECORD_REJECTED",
		"APPLICATION_MARK_RECEIVED",
		"APPLICATION_ENTER_SCRUTINY",
		"APPLICATION_RECORD_ISSUED",
		"APPLICATION_COMMIT_WITHDRAWAL",
		"APPLICATION_REQUEST_COMMITTED",
	] {
		d := eval(with_action(citizen_input, action), {})
		d.allow == false
		d.reason_code == "ROLE_NOT_PERMITTED"
	}
}

test_citizen_owner_path_limited_to_granted_resource_types if {
	inp := json.patch(citizen_input, [
		{"op": "replace", "path": "/resource/resource_type", "value": "ExampleAggregate"},
		{"op": "replace", "path": "/action", "value": "VIEW"},
	])
	eval(inp, {}).allow == false
}

test_citizen_cross_tenant_resource_denied if {
	inp := json.patch(citizen_input, [{"op": "replace", "path": "/resource/tenant_id", "value": T2}])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "TENANT_MISMATCH"
}

test_citizen_without_tenant_context_denied if {
	inp := json.patch(citizen_input, [{"op": "replace", "path": "/subject/tenant_id", "value": null}])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "TENANT_MISMATCH"
}

test_citizen_on_tenant_not_onboarded_denied if {
	d := authz.decision with input as citizen_input with data.sf.tenants as {T2: tenant_t2}
	d.allow == false
	d.reason_code == "POLICY_DATA_MISSING"
}

test_citizen_unknown_action_denied if {
	d := eval(with_action(citizen_input, "APPLICATION_DELETE"), {})
	d.allow == false
	d.reason_code == "UNKNOWN_ACTION"
}

test_officer_role_grant_allows_decision if {
	d := eval(officer_input, case_officer_role)
	d.allow == true
}

test_officer_without_role_denied if {
	d := eval(officer_input, {})
	d.allow == false
	d.reason_code == "ROLE_NOT_PERMITTED"
}

test_officer_cannot_use_owner_path if {
	inp := json.patch(officer_input, [
		{"op": "replace", "path": "/subject/roles", "value": []},
		{"op": "replace", "path": "/subject/user_id", "value": CITIZEN_A},
		{"op": "replace", "path": "/action", "value": "APPLICATION_READ"},
	])
	d := eval(inp, case_officer_role)
	d.allow == false
	d.reason_code == "ROLE_NOT_PERMITTED"
}

test_officer_cross_tenant_denied if {
	inp := json.patch(officer_input, [{"op": "replace", "path": "/resource/tenant_id", "value": T2}])
	d := eval(inp, case_officer_role)
	d.allow == false
	d.reason_code == "TENANT_MISMATCH"
}

officer_session_role := {T1: {"roles": {"CASE_OFFICER": {
	"actions": ["OFFICER_SESSION_ISSUE", "OFFICER_SESSION_REVOKE"],
	"resource_types": ["OfficerSession"],
	"jurisdiction_scope": "TENANT_WIDE",
}}}}

officer_session_input := {
	"subject": {
		"user_id": U1,
		"actor_type": "OFFICER",
		"tenant_id": T1,
		"roles": ["CASE_OFFICER"],
		"jurisdiction_ids": [],
		"assurance": "MFA",
	},
	"resource": {"resource_type": "OfficerSession", "tenant_id": T1, "classification": "TENANT_SCOPED"},
	"action": "OFFICER_SESSION_ISSUE",
}

test_cmp004_officer_session_issue_by_role if {
	eval(officer_session_input, officer_session_role).allow == true
}

test_cmp004_officer_session_needs_role if {
	d := eval(officer_session_input, {})
	d.allow == false
	d.reason_code == "ROLE_NOT_PERMITTED"
}

test_cmp004_officer_session_not_citizen_owned if {
	inp := json.patch(officer_session_input, [
		{"op": "replace", "path": "/subject/actor_type", "value": "CITIZEN"},
		{"op": "replace", "path": "/subject/roles", "value": []},
		{"op": "add", "path": "/resource/owner_id", "value": U1},
	])
	eval(inp, officer_session_role).allow == false
}
