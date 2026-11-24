package sf.authz_test

import rego.v1

# SF-71 SAMPLE_LAB M02 tenant workforce user admin. TENANT_ADMIN_STUDIO may manage
# WorkforceUser within its tenant; other roles and cross-tenant subjects fail closed.

workforce_actions := [
	"WORKFORCE_USER_LIST",
	"WORKFORCE_USER_READ",
	"WORKFORCE_USER_CREATE",
	"WORKFORCE_USER_UPDATE",
	"WORKFORCE_USER_ASSIGN_ROLES",
	"WORKFORCE_ROLE_CATALOGUE_READ",
]

workforce_roles := {T1: {"roles": {
	"TENANT_ADMIN_STUDIO": {
		"actions": workforce_actions,
		"resource_types": ["WorkforceUser", "WorkforceRoleCatalogue"],
		"jurisdiction_scope": "TENANT_WIDE",
		"all_services": true,
	},
	"SAMPLE_LAB_CASE_OFFICER": {
		"actions": ["APPLICATION_READ"],
		"resource_types": ["ApplicationCase"],
		"jurisdiction_scope": "TENANT_WIDE",
		"all_services": true,
	},
}}}

workforce_input(role, resource_type, action) := {
	"subject": {
		"user_id": U1,
		"actor_type": "OFFICER",
		"tenant_id": T1,
		"roles": [role],
		"jurisdiction_ids": [],
		"assurance": "MFA",
	},
	"resource": {
		"resource_type": resource_type,
		"tenant_id": T1,
		"classification": "TENANT_SCOPED",
	},
	"action": action,
	"environment": {"request_time": "2026-11-24T06:00:00Z"},
}

test_workforce_actions_are_known if {
	every action in workforce_actions {
		data.sf.common.actions[action]
	}
}

test_workforce_resource_types_registered if {
	"WorkforceUser" in data.sf.common.resource_types
	"WorkforceRoleCatalogue" in data.sf.common.resource_types
}

test_tenant_admin_may_manage_workforce_users if {
	every action in [
		"WORKFORCE_USER_LIST",
		"WORKFORCE_USER_READ",
		"WORKFORCE_USER_CREATE",
		"WORKFORCE_USER_UPDATE",
		"WORKFORCE_USER_ASSIGN_ROLES",
	] {
		eval(workforce_input("TENANT_ADMIN_STUDIO", "WorkforceUser", action), workforce_roles).allow == true
	}
	eval(
		workforce_input("TENANT_ADMIN_STUDIO", "WorkforceRoleCatalogue", "WORKFORCE_ROLE_CATALOGUE_READ"),
		workforce_roles,
	).allow == true
}

test_case_officer_cannot_manage_workforce_users if {
	eval(workforce_input("SAMPLE_LAB_CASE_OFFICER", "WorkforceUser", "WORKFORCE_USER_LIST"), workforce_roles).allow == false
}

test_workforce_cross_tenant_resource_denied if {
	inp := json.patch(workforce_input("TENANT_ADMIN_STUDIO", "WorkforceUser", "WORKFORCE_USER_LIST"), [
		{"op": "replace", "path": "/resource/tenant_id", "value": T2},
	])
	eval(inp, workforce_roles).allow == false
}
