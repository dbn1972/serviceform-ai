package sf.authz

import rego.v1

default jurisdiction_denied := false

role_scope(role) := object.get(role_entry(role), "jurisdiction_scope", "TENANT_WIDE")

jurisdiction_denied if {
	some role in matching_roles
	role_scope(role) != "TENANT_WIDE"
	not input.resource.jurisdiction_id
}

jurisdiction_denied if {
	some role in matching_roles
	role_scope(role) == "ASSIGNED_ONLY"
	not input.resource.jurisdiction_id in object.get(input.subject, "jurisdiction_ids", [])
}

jurisdiction_denied if {
	some role in matching_roles
	role_scope(role) == "DESCENDANTS"
	not descendant_ok(input.resource.jurisdiction_id)
}

jurisdiction_denied if {
	some role in matching_roles
	role_scope(role) == "EXPLICIT_LIST"
	allowed := object.get(role_entry(role), "jurisdiction_ids", [])
	not input.resource.jurisdiction_id in allowed
}

descendant_ok(jid) if {
	jid in object.get(input.subject, "jurisdiction_ids", [])
}

descendant_ok(jid) if {
	some assigned in object.get(input.subject, "jurisdiction_ids", [])
	ancestors := object.get(object.get(data.sf.tenants[tenant_key], "jurisdiction_ancestors", {}), jid, [])
	assigned in ancestors
}
