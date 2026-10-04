package sf.authz_test

import rego.v1

test_workflow_positive if {
	inp := object.union(base_input, {"workflow_context": {"required_action": "VIEW", "required_role": "ROLE_A"}})
	d := eval(inp, {})
	d.allow == true
}
