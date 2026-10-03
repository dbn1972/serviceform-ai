package sf.authz

import rego.v1

default tenant_mismatch := false

default write_action := false

input_present if {
	input.subject
	input.resource
	input.action
	is_string(input.action)
	count(input.action) > 0
}

action_known if {
	input.action
	data.sf.common.actions[input.action]
}

classification := object.get(input.resource, "classification", "")

write_action if {
	data.sf.common.actions[input.action].action_class != "READ_ONLY"
}

tenant_mismatch if {
	classification == ""
}

tenant_mismatch if {
	classification == "TENANT_SCOPED"
	input.subject.tenant_id == null
}

tenant_mismatch if {
	classification == "TENANT_SCOPED"
	input.resource.tenant_id == null
}

tenant_mismatch if {
	classification == "TENANT_SCOPED"
	input.subject.tenant_id != input.resource.tenant_id
}

tenant_mismatch if {
	classification == "GLOBAL"
	write_action
	not global_writable
}

global_writable if {
	input.action in object.get(data.sf.common, "global_writable_actions", [])
}

tenant_key := input.subject.tenant_id

tenant_data_present if {
	classification == "PLATFORM_OPERATIONAL"
}

tenant_data_present if {
	classification == "GLOBAL"
	not write_action
}

tenant_data_present if {
	classification == "TENANT_SCOPED"
	tenant_key
	data.sf.tenants[tenant_key]
}

tenant_data_present if {
	classification == "JURISDICTION_SCOPED"
	tenant_key
	data.sf.tenants[tenant_key]
}
