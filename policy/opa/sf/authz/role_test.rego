package sf.authz_test

import rego.v1

test_role_office_mismatch if {
	inp := json.patch(base_input, [
		{"op": "replace", "path": "/subject/roles", "value": ["ROLE_OFFICE"]},
		{"op": "replace", "path": "/subject/office_id", "value": "00000000-0000-4000-8000-0000000000ff"},
	])
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "OFFICE_MISMATCH"
}
