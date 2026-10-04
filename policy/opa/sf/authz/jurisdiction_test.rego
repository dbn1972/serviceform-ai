package sf.authz_test

import rego.v1

test_assigned_only_positive if {
	inp := json.patch(base_input, [
		{"op": "replace", "path": "/subject/roles", "value": ["ROLE_ASSIGNED"]},
		{"op": "replace", "path": "/resource/jurisdiction_id", "value": J_ROOT},
	])
	d := eval(inp, {})
	d.allow == true
}
