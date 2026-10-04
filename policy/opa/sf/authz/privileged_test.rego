package sf.authz_test

import rego.v1

test_privileged_expired if {
	inp := json.patch(base_input, [{"op": "replace", "path": "/action", "value": "PRIVILEGED_ACCESS_APPROVE"}])
	g := {T1: {U1: {
		"status": "APPROVED",
		"approved_by": U2,
		"grantee_user_id": U1,
		"tenant_id": T1,
		"starts_at": "2026-01-01T00:00:00Z",
		"expires_at": "2026-02-01T00:00:00Z",
		"scope_actions": ["PRIVILEGED_ACCESS_APPROVE"],
		"scope_resource_types": ["ExampleAggregate"],
	}}}
	d := eval_rt(inp, g)
	d.allow == false
	d.reason_code == "PRIVILEGED_EXPIRED"
}
