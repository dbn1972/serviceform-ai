package sf.authz

import rego.v1

default workflow_mismatch := false

workflow := object.get(input, "workflow_context", {})

workflow_mismatch if {
	count(workflow) > 0
	object.get(workflow, "required_action", input.action) != input.action
}

# Officers must hold the assignment role_code. SYSTEM workload (CMP-016 → CMP-017 create/cancel)
# is not an officer claimant; required_role does not apply to it.
workflow_mismatch if {
	req := object.get(workflow, "required_role", "")
	req != ""
	object.get(input.subject, "actor_type", "") != "SYSTEM"
	not req in object.get(input.subject, "roles", [])
}
