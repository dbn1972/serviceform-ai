package system.log_test

import data.system.log
import rego.v1

test_mask_removes_user_and_workflow_fields if {
	paths := {p | some e in log.mask; p := e.path}
	"/input/subject/user_id" in paths
	"/input/resource/owner_id" in paths
	"/input/resource/application_id" in paths
	"/input/resource/task_id" in paths
	"/input/workflow_context/workflow_instance_id" in paths
}
