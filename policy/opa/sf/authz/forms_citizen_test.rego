package sf.authz_test

import data.sf.authz
import rego.v1

# CCR-M10-002: citizen use of CMP-009 on the portal path. FORM_INTERPRET reads the tenant's
# published form (no owner). FORM_EXECUTION_EXECUTE creates an execution owned by the requester.

form_interpret_input := {
	"subject": {
		"user_id": CITIZEN_A,
		"actor_type": "CITIZEN",
		"tenant_id": T1,
		"roles": [],
		"jurisdiction_ids": [],
		"assurance": "OTP",
	},
	"resource": {"resource_type": "FormDefinition", "tenant_id": T1, "classification": "TENANT_SCOPED"},
	"action": "FORM_INTERPRET",
	"environment": {"request_time": "2026-11-05T10:00:00Z"},
}

form_execute_input := json.patch(form_interpret_input, [
	{"op": "replace", "path": "/resource/resource_type", "value": "FormExecution"},
	{"op": "add", "path": "/resource/owner_id", "value": CITIZEN_A},
	{"op": "replace", "path": "/action", "value": "FORM_EXECUTION_EXECUTE"},
])

test_citizen_may_interpret_published_form if {
	d := eval(form_interpret_input, {})
	d.allow == true
	d.policy_revision == "m10-b3"
}

test_citizen_may_validate_own_execution if {
	eval(form_execute_input, {}).allow == true
}

test_citizen_execution_for_another_owner_denied if {
	inp := json.patch(form_execute_input, [{"op": "replace", "path": "/resource/owner_id", "value": CITIZEN_B}])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "ROLE_NOT_PERMITTED"
}

test_citizen_execution_without_owner_denied if {
	inp := json.patch(form_execute_input, [{"op": "remove", "path": "/resource/owner_id"}])
	eval(inp, {}).allow == false
}

test_citizen_cannot_read_executions if {
	every resource_type in ["FormExecution", "FormDefinition"] {
		inp := json.patch(form_execute_input, [
			{"op": "replace", "path": "/action", "value": "FORM_EXECUTION_READ"},
			{"op": "replace", "path": "/resource/resource_type", "value": resource_type},
		])
		d := eval(inp, {})
		d.allow == false
		d.reason_code == "ROLE_NOT_PERMITTED"
	}
}

test_published_grant_is_bound_to_its_resource_type if {
	inp := json.patch(form_interpret_input, [
		{"op": "replace", "path": "/resource/resource_type", "value": "ApplicationCase"},
	])
	eval(inp, {}).allow == false
}

test_published_grant_does_not_open_case_actions if {
	every action in ["APPLICATION_READ", "APPLICATION_LIST", "APPLICATION_RECORD_APPROVED"] {
		inp := json.patch(form_interpret_input, [{"op": "replace", "path": "/action", "value": action}])
		eval(inp, {}).allow == false
	}
}

test_citizen_interpret_cross_tenant_denied if {
	inp := json.patch(form_interpret_input, [{"op": "replace", "path": "/resource/tenant_id", "value": T2}])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "TENANT_MISMATCH"
}

test_citizen_interpret_needs_assurance if {
	every assurance in ["NONE", "", "WORKLOAD_IDENTITY"] {
		inp := json.patch(form_interpret_input, [{"op": "replace", "path": "/subject/assurance", "value": assurance}])
		eval(inp, {}).allow == false
	}
}

test_citizen_with_roles_cannot_interpret if {
	inp := json.patch(form_interpret_input, [{"op": "replace", "path": "/subject/roles", "value": ["CASE_OFFICER"]}])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "CITIZEN_ROLES_FORBIDDEN"
}

test_citizen_interpret_on_tenant_not_onboarded_denied if {
	d := authz.decision with input as form_interpret_input with data.sf.tenants as {T2: tenant_t2}
	d.allow == false
	d.reason_code == "POLICY_DATA_MISSING"
}

test_officer_cannot_use_published_citizen_grant if {
	inp := json.patch(form_interpret_input, [
		{"op": "replace", "path": "/subject/actor_type", "value": "OFFICER"},
		{"op": "replace", "path": "/subject/user_id", "value": U1},
		{"op": "replace", "path": "/subject/assurance", "value": "MFA"},
	])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "ROLE_NOT_PERMITTED"
}
