package sf.authz_test

import rego.v1

test_workflow_positive if {
	inp := object.union(base_input, {"workflow_context": {"required_action": "VIEW", "required_role": "ROLE_A"}})
	d := eval(inp, {})
	d.allow == true
}

test_workflow_system_skips_required_role if {
	inp := object.union(base_input, {
		"subject": object.union(base_input.subject, {"actor_type": "SYSTEM", "roles": ["SEQUENCER"]}),
		"workflow_context": {"required_role": "ROLE_A"},
	})
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "ROLE_NOT_PERMITTED"
}

test_workflow_officer_required_role_mismatch if {
	inp := object.union(base_input, {"workflow_context": {"required_role": "MISSING_ROLE"}})
	d := eval(inp, {})
	d.allow == false
	d.reason_code == "WORKFLOW_MISMATCH"
}
