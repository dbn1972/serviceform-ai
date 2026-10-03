package sf.authz

import rego.v1

default privileged_reason := ""

default time_required_missing := false

action_class := object.get(object.get(data.sf.common.actions, input.action, {}), "action_class", "PROTECTED")

default needs_privileged := false

default has_grant := false

default grant_expired := false

default grant_covers := false

default no_mfa := false

default missing_grant := false

default unapproved := false

default self_approved := false

default wrong_tenant := false

default out_of_scope := false

default is_grant_expired := false

needs_privileged if action_class == "PRIVILEGED"

needs_privileged if input.subject.actor_type == "PRIVILEGED_ADMIN"

has_grant if grant != null

grant := object.get(
	object.get(object.get(data.sf_runtime, "privileged_grants", {}), tenant_key, {}),
	input.subject.user_id,
	null,
)

grant_expired if {
	has_grant
	time.parse_rfc3339_ns(input.environment.request_time) >= time.parse_rfc3339_ns(grant.expires_at)
}

grant_expired if {
	has_grant
	time.parse_rfc3339_ns(input.environment.request_time) < time.parse_rfc3339_ns(grant.starts_at)
}

grant_covers if {
	has_grant
	input.action in object.get(grant, "scope_actions", [])
	input.resource.resource_type in object.get(grant, "scope_resource_types", [])
}

time_required_missing if {
	needs_privileged
	not request_time_present
}

time_required_missing if {
	delegation_id != null
	not request_time_present
}

no_mfa if {
	needs_privileged
	object.get(input.subject, "assurance", "") != "MFA"
}

no_mfa := false if object.get(input.subject, "assurance", "") == "MFA"

no_mfa := false if not needs_privileged

missing_grant if {
	needs_privileged
	object.get(input.subject, "assurance", "") == "MFA"
	not has_grant
}

missing_grant := false if has_grant

missing_grant := false if not needs_privileged

unapproved if {
	has_grant
	object.get(grant, "status", "") != "APPROVED"
}

unapproved := false if {
	has_grant
	object.get(grant, "status", "") == "APPROVED"
}

unapproved := false if not has_grant

self_approved if {
	has_grant
	grant.approved_by == grant.grantee_user_id
}

self_approved := false if {
	has_grant
	grant.approved_by != grant.grantee_user_id
}

self_approved := false if not has_grant

wrong_tenant if {
	has_grant
	grant.tenant_id != input.resource.tenant_id
}

wrong_tenant := false if {
	has_grant
	grant.tenant_id == input.resource.tenant_id
}

wrong_tenant := false if not has_grant

out_of_scope if {
	has_grant
	not grant_covers
}

out_of_scope := false if grant_covers

out_of_scope := false if not has_grant

is_grant_expired if grant_expired

is_grant_expired := false if {
	has_grant
	not grant_expired
}

is_grant_expired := false if not has_grant

priv_codes := [c |
	some pair in [
		{"on": no_mfa, "code": "PRIVILEGED_ASSURANCE"},
		{"on": missing_grant, "code": "PRIVILEGED_GRANT_MISSING"},
		{"on": unapproved, "code": "PRIVILEGED_GRANT_UNAPPROVED"},
		{"on": self_approved, "code": "PRIVILEGED_SELF_APPROVED"},
		{"on": is_grant_expired, "code": "PRIVILEGED_EXPIRED"},
		{"on": wrong_tenant, "code": "PRIVILEGED_TENANT"},
		{"on": out_of_scope, "code": "PRIVILEGED_SCOPE"},
	]
	pair.on
	c := pair.code
]

privileged_reason := priv_codes[0] if count(priv_codes) > 0

privileged_reason := "" if count(priv_codes) == 0
