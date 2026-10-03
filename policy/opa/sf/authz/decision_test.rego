package sf.authz_test

import data.sf.authz
import rego.v1

eval(inp, extra) := d if {
	d := authz.decision with input as inp with data.sf.tenants as object.union(tenants, extra)
}

eval_rt(inp, grants) := d if {
	d := authz.decision with input as inp with data.sf.tenants as tenants with data.sf_runtime.privileged_grants as grants
}

test_positive_view_allow if {
	d := eval(base_input, {})
	d.allow == true
	d.reason_code == "ALLOW"
	d.policy_revision == "w1-cmp048"
}

test_r1_empty_input if {
	d := authz.decision with input as {}
	d.allow == false
	d.reason_code == "INPUT_MISSING"
}

test_r2_unknown_action if {
	d := eval(object.union(base_input, {"action": "NOT_A_REAL_ACTION"}), {})
	d.allow == false
	d.reason_code == "UNKNOWN_ACTION"
}

test_r3_role_lacks_action if {
	inp := json.patch(base_input, [{"op": "replace", "path": "/subject/roles", "value": []}])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "ROLE_NOT_PERMITTED"
}

test_r3_role_wrong_resource if {
	inp := json.patch(base_input, [{"op": "replace", "path": "/resource/resource_type", "value": "OtherThing"}])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "ROLE_NOT_PERMITTED"
}

test_r4_wrong_tenant if {
	inp := json.patch(base_input, [{"op": "replace", "path": "/resource/tenant_id", "value": T2}])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "TENANT_MISMATCH"
}

test_r4_null_subject_tenant if {
	inp := json.patch(base_input, [{"op": "replace", "path": "/subject/tenant_id", "value": null}])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "TENANT_MISMATCH"
}

test_r4_null_resource_tenant if {
	inp := json.patch(base_input, [{"op": "replace", "path": "/resource/tenant_id", "value": null}])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "TENANT_MISMATCH"
}

test_r5_tenant_data_absent if {
	d := authz.decision with input as base_input with data.sf.tenants as {}
	d.allow == false
	d.reason_code == "POLICY_DATA_MISSING"
}

test_r6_assigned_only_child if {
	inp := json.patch(base_input, [
		{"op": "replace", "path": "/subject/roles", "value": ["ROLE_ASSIGNED"]},
		{"op": "replace", "path": "/resource/jurisdiction_id", "value": J_CHILD},
	])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "JURISDICTION_DENIED"
}

test_r6_descendants_sibling if {
	inp := json.patch(base_input, [
		{"op": "replace", "path": "/subject/roles", "value": ["ROLE_DESC"]},
		{"op": "replace", "path": "/subject/jurisdiction_ids", "value": [J_CHILD]},
		{"op": "replace", "path": "/resource/jurisdiction_id", "value": J_SIB},
	])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "JURISDICTION_DENIED"
}

test_r6_missing_jurisdiction if {
	inp := json.patch(base_input, [
		{"op": "replace", "path": "/subject/roles", "value": ["ROLE_ASSIGNED"]},
		{"op": "remove", "path": "/resource/jurisdiction_id"},
	])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "JURISDICTION_DENIED"
}

test_r6_descendants_positive if {
	inp := json.patch(base_input, [
		{"op": "replace", "path": "/subject/roles", "value": ["ROLE_DESC"]},
		{"op": "replace", "path": "/subject/jurisdiction_ids", "value": [J_ROOT]},
		{"op": "replace", "path": "/resource/jurisdiction_id", "value": J_CHILD},
	])
	d := eval(inp, {})
	d.allow == true
}

test_r7_org_mismatch if {
	inp := json.patch(base_input, [
		{"op": "replace", "path": "/subject/roles", "value": ["ROLE_ORG"]},
		{"op": "replace", "path": "/subject/organisation_id", "value": "00000000-0000-4000-8000-000000000000"},
	])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "ORG_MISMATCH"
}

test_r8_service_out if {
	inp := json.patch(base_input, [
		{"op": "replace", "path": "/subject/roles", "value": ["ROLE_SVC"]},
		{"op": "replace", "path": "/resource/service_id", "value": "00000000-0000-4000-8000-000000000001"},
	])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "SERVICE_OUT_OF_SCOPE"
}

test_r9_delegation_unknown if {
	inp := json.patch(base_input, [{"op": "add", "path": "/subject/delegation_id", "value": "00000000-0000-4000-8000-0000000000de"}])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "DELEGATION_UNKNOWN"
}

test_r9_delegation_subject if {
	inp := json.patch(base_input, [
		{"op": "add", "path": "/subject/delegation_id", "value": DEL},
		{"op": "replace", "path": "/subject/user_id", "value": U2},
	])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "DELEGATION_SUBJECT"
}

test_r9_delegation_expired if {
	inp := json.patch(base_input, [
		{"op": "add", "path": "/subject/delegation_id", "value": DEL},
		{"op": "replace", "path": "/environment/request_time", "value": "2027-01-01T00:00:00Z"},
	])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "DELEGATION_EXPIRED"
}

test_r9_delegation_positive if {
	inp := json.patch(base_input, [{"op": "add", "path": "/subject/delegation_id", "value": DEL}])
	d := eval(inp, {})
	d.allow == true
}

test_r10_time_missing_delegation if {
	inp := json.patch(base_input, [
		{"op": "add", "path": "/subject/delegation_id", "value": DEL},
		{"op": "remove", "path": "/environment/request_time"},
	])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "REQUEST_TIME_MISSING"
}

test_r11_no_grant if {
	inp := json.patch(base_input, [{"op": "replace", "path": "/action", "value": "PRIVILEGED_ACCESS_APPROVE"}])
	d := eval_rt(inp, {})
	d.allow == false
	d.reason_code == "PRIVILEGED_GRANT_MISSING"
}

test_r11_unapproved_grant if {
	inp := json.patch(base_input, [{"op": "replace", "path": "/action", "value": "PRIVILEGED_ACCESS_APPROVE"}])
	g := {T1: {U1: {
		"status": "REQUESTED",
		"approved_by": U2,
		"grantee_user_id": U1,
		"tenant_id": T1,
		"starts_at": "2026-01-01T00:00:00Z",
		"expires_at": "2026-12-31T00:00:00Z",
		"scope_actions": ["PRIVILEGED_ACCESS_APPROVE"],
		"scope_resource_types": ["ExampleAggregate"],
	}}}
	d := eval_rt(inp, g)
	d.allow == false
	d.reason_code == "PRIVILEGED_GRANT_UNAPPROVED"
}

test_r11_self_approved if {
	inp := json.patch(base_input, [{"op": "replace", "path": "/action", "value": "PRIVILEGED_ACCESS_APPROVE"}])
	g := {T1: {U1: {
		"status": "APPROVED",
		"approved_by": U1,
		"grantee_user_id": U1,
		"tenant_id": T1,
		"starts_at": "2026-01-01T00:00:00Z",
		"expires_at": "2026-12-31T00:00:00Z",
		"scope_actions": ["PRIVILEGED_ACCESS_APPROVE"],
		"scope_resource_types": ["ExampleAggregate"],
	}}}
	d := eval_rt(inp, g)
	d.allow == false
	d.reason_code == "PRIVILEGED_SELF_APPROVED"
}

test_r11_grant_other_tenant if {
	inp := json.patch(base_input, [{"op": "replace", "path": "/action", "value": "PRIVILEGED_ACCESS_APPROVE"}])
	g := {T1: {U1: {
		"status": "APPROVED",
		"approved_by": U2,
		"grantee_user_id": U1,
		"tenant_id": T2,
		"starts_at": "2026-01-01T00:00:00Z",
		"expires_at": "2026-12-31T00:00:00Z",
		"scope_actions": ["PRIVILEGED_ACCESS_APPROVE"],
		"scope_resource_types": ["ExampleAggregate"],
	}}}
	d := eval_rt(inp, g)
	d.allow == false
	d.reason_code == "PRIVILEGED_TENANT"
}

test_r11_assurance if {
	inp := json.patch(base_input, [
		{"op": "replace", "path": "/action", "value": "PRIVILEGED_ACCESS_APPROVE"},
		{"op": "replace", "path": "/subject/assurance", "value": "OTP"},
	])
	d := eval_rt(inp, {})
	d.allow == false
	d.reason_code == "PRIVILEGED_ASSURANCE"
}

test_r11_positive_grant if {
	inp := json.patch(base_input, [{"op": "replace", "path": "/action", "value": "PRIVILEGED_ACCESS_APPROVE"}])
	g := {T1: {U1: {
		"status": "APPROVED",
		"approved_by": U2,
		"grantee_user_id": U1,
		"tenant_id": T1,
		"starts_at": "2026-01-01T00:00:00Z",
		"expires_at": "2026-12-31T00:00:00Z",
		"scope_actions": ["PRIVILEGED_ACCESS_APPROVE"],
		"scope_resource_types": ["ExampleAggregate"],
	}}}
	d := eval_rt(inp, g)
	d.allow == true
}

test_r12_workflow_mismatch if {
	inp := object.union(base_input, {"workflow_context": {"required_action": "CREATE", "required_role": "ROLE_A"}})
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "WORKFLOW_MISMATCH"
}

test_r13_output_shape if {
	d := authz.decision with input as {}
	d.allow == false
	d.reason_code
	d.policy_revision
}

test_002_12_role_in_other_tenant if {
	d := authz.decision with input as base_input with data.sf.tenants as {T2: tenant_t2}
	d.allow == false
	d.reason_code == "POLICY_DATA_MISSING"
}

test_002_12_classification_absent if {
	inp := json.patch(base_input, [{"op": "remove", "path": "/resource/classification"}])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "TENANT_MISMATCH"
}

test_002_12_global_write if {
	inp := json.patch(base_input, [
		{"op": "replace", "path": "/resource/classification", "value": "GLOBAL"},
		{"op": "replace", "path": "/action", "value": "CREATE"},
	])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "TENANT_MISMATCH"
}

test_002_14_grant_wrong_user if {
	inp := json.patch(base_input, [{"op": "replace", "path": "/action", "value": "PRIVILEGED_ACCESS_APPROVE"}])
	g := {T1: {U2: {
		"status": "APPROVED",
		"approved_by": U1,
		"grantee_user_id": U2,
		"tenant_id": T1,
		"starts_at": "2026-01-01T00:00:00Z",
		"expires_at": "2026-12-31T00:00:00Z",
		"scope_actions": ["PRIVILEGED_ACCESS_APPROVE"],
		"scope_resource_types": ["ExampleAggregate"],
	}}}
	d := eval_rt(inp, g)
	d.allow == false
	d.reason_code == "PRIVILEGED_GRANT_MISSING"
}

test_undefined_input_action_null if {
	inp := json.patch(base_input, [{"op": "replace", "path": "/action", "value": null}])
	d := eval(inp, {})
	d.allow == false
}

test_system_authz_pep_decision if {
	data.system.authz.allow with input as {"identity": "pep", "method": "POST", "path": ["v1", "data", "sf", "authz", "decision"]}
}

test_system_authz_unauth_put_denied if {
	not data.system.authz.allow with input as {"identity": "", "method": "PUT", "path": ["v1", "data", "sf_runtime", "privileged_grants"]}
}

test_system_authz_pep_cannot_write_policy if {
	not data.system.authz.allow with input as {"identity": "pep", "method": "PUT", "path": ["v1", "policies", "x"]}
}

test_manifest_revision_matches_meta if {
	data.sf.meta.policy_revision == "w1-cmp048"
}
