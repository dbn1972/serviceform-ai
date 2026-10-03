package sf.authz_test

import rego.v1

test_delegation_not_started if {
	inp := json.patch(base_input, [
		{"op": "add", "path": "/subject/delegation_id", "value": DEL},
		{"op": "replace", "path": "/environment/request_time", "value": "2025-01-01T00:00:00Z"},
	])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "DELEGATION_NOT_STARTED"
}
