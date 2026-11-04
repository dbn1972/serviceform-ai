package sf.authz

import rego.v1

# Citizens are platform-global and hold no tenant roles (Tenant Isolation v1.0 s6, s10; ADR-0007).
# A citizen may act on a tenant-scoped resource only as its owner, and only for actions the
# platform-common grants allow for that resource type. Tenant match and onboarded-tenant data
# are still enforced by the tenant rules; RLS still applies the tenant row boundary.

default citizen_owner_permits := false

default citizen_roles_forbidden := false

is_citizen if input.subject.actor_type == "CITIZEN"

citizen_grant := object.get(
	object.get(data.sf.common, "citizen_owner_grants", {}),
	object.get(input.resource, "resource_type", ""),
	{},
)

citizen_roles_forbidden if {
	is_citizen
	count(object.get(input.subject, "roles", [])) > 0
}

citizen_owner_permits if {
	is_citizen
	not citizen_roles_forbidden
	input.action in object.get(citizen_grant, "actions", [])
	object.get(input.subject, "assurance", "") in object.get(citizen_grant, "assurance", [])
	owner := object.get(input.resource, "owner_id", "")
	is_string(owner)
	owner != ""
	owner == input.subject.user_id
}
