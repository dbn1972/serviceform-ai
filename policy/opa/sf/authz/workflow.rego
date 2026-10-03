package sf.authz

import rego.v1

default workflow_mismatch := false

workflow := object.get(input, "workflow_context", {})

workflow_mismatch if {
	count(workflow) > 0
	object.get(workflow, "required_action", input.action) != input.action
}

workflow_mismatch if {
	req := object.get(workflow, "required_role", "")
	req != ""
	not req in object.get(input.subject, "roles", [])
}
