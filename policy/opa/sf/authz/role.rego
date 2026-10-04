package sf.authz

import rego.v1

default role_permits := false

default org_mismatch := false

default office_mismatch := false

default service_out_of_scope := false

matching_roles contains role if {
	some role in object.get(input.subject, "roles", [])
	entry := object.get(object.get(data.sf.tenants[tenant_key], "roles", {}), role, {})
	input.action in object.get(entry, "actions", [])
	input.resource.resource_type in object.get(entry, "resource_types", [])
}

role_permits if count(matching_roles) > 0

role_entry(role) := object.get(object.get(data.sf.tenants[tenant_key], "roles", {}), role, {})

org_mismatch if {
	some role in matching_roles
	ids := object.get(role_entry(role), "organisation_ids", [])
	count(ids) > 0
	not input.subject.organisation_id in ids
}

office_mismatch if {
	some role in matching_roles
	ids := object.get(role_entry(role), "office_ids", [])
	count(ids) > 0
	not input.subject.office_id in ids
}

service_out_of_scope if {
	some role in matching_roles
	ids := object.get(role_entry(role), "service_ids", [])
	not object.get(role_entry(role), "all_services", false)
	count(ids) > 0
	input.resource.service_id
	not input.resource.service_id in ids
}
