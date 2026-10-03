package system.log

import rego.v1

mask contains {"op": "remove", "path": "/input/subject/user_id"}

mask contains {"op": "remove", "path": "/input/resource/owner_id"}

mask contains {"op": "remove", "path": "/input/resource/application_id"}

mask contains {"op": "remove", "path": "/input/resource/task_id"}

mask contains {"op": "remove", "path": "/input/workflow_context/workflow_instance_id"}

mask contains {"op": "remove", "path": "/input/workflow_context/workflow_node_id"}
