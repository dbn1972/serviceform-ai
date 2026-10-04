package sf.authz_test

import rego.v1

T1 := "11111111-1111-4111-8111-111111111111"

T2 := "22222222-2222-4222-8222-222222222222"

U1 := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

U2 := "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

J_ROOT := "55555555-5555-4555-8555-555555555555"

J_CHILD := "66666666-6666-4666-8666-666666666666"

J_SIB := "77777777-7777-4777-8777-777777777777"

ORG := "33333333-3333-4333-8333-333333333333"

OFFICE := "44444444-4444-4444-8444-444444444444"

SVC := "88888888-8888-4888-8888-888888888888"

DEL := "99999999-9999-4999-8999-999999999999"

tenants := {T1: tenant_t1, T2: tenant_t2}

tenant_t1 := {
	"roles": {
		"ROLE_A": {
			"actions": [
				"VIEW",
				"CREATE",
				"PRIVILEGED_ACCESS_REQUEST",
				"PRIVILEGED_ACCESS_APPROVE",
				"PRIVILEGED_ACCESS_REVOKE",
				"PRIVILEGED_ACCESS_REVIEW",
				"SECURITY_POLICY_REGISTER",
				"SECURITY_POLICY_ACTIVATE",
				"SECURITY_INCIDENT_REPORT",
			],
			"resource_types": ["ExampleAggregate", "PrivilegedAccess", "SecurityPolicy", "SecurityIncident"],
			"jurisdiction_scope": "TENANT_WIDE",
			"all_services": true,
		},
		"ROLE_ASSIGNED": {
			"actions": ["VIEW"],
			"resource_types": ["ExampleAggregate"],
			"jurisdiction_scope": "ASSIGNED_ONLY",
		},
		"ROLE_DESC": {
			"actions": ["VIEW"],
			"resource_types": ["ExampleAggregate"],
			"jurisdiction_scope": "DESCENDANTS",
		},
		"ROLE_ORG": {
			"actions": ["VIEW"],
			"resource_types": ["ExampleAggregate"],
			"jurisdiction_scope": "TENANT_WIDE",
			"organisation_ids": [ORG],
		},
		"ROLE_OFFICE": {
			"actions": ["VIEW"],
			"resource_types": ["ExampleAggregate"],
			"jurisdiction_scope": "TENANT_WIDE",
			"office_ids": [OFFICE],
		},
		"ROLE_SVC": {
			"actions": ["VIEW"],
			"resource_types": ["ExampleAggregate"],
			"jurisdiction_scope": "TENANT_WIDE",
			"service_ids": [SVC],
		},
	},
	"jurisdiction_ancestors": {J_CHILD: [J_ROOT], J_SIB: [J_ROOT], J_ROOT: []},
	"delegations": {DEL: {
		"delegator_user_id": U2,
		"delegate_user_id": U1,
		"actions": ["VIEW"],
		"scope": "TENANT",
		"starts_at": "2026-01-01T00:00:00Z",
		"ends_at": "2026-12-31T00:00:00Z",
		"status": "ACTIVE",
		"approval_required": false,
	}},
}

tenant_t2 := {"roles": {"ROLE_A": {
	"actions": ["VIEW"],
	"resource_types": ["ExampleAggregate"],
	"jurisdiction_scope": "TENANT_WIDE",
	"all_services": true,
}}}

base_input := {
	"subject": {
		"user_id": U1,
		"actor_type": "OFFICER",
		"tenant_id": T1,
		"roles": ["ROLE_A"],
		"jurisdiction_ids": [J_ROOT],
		"assurance": "MFA",
		"organisation_id": ORG,
		"office_id": OFFICE,
	},
	"resource": {
		"resource_type": "ExampleAggregate",
		"tenant_id": T1,
		"classification": "TENANT_SCOPED",
		"jurisdiction_id": J_ROOT,
		"service_id": SVC,
	},
	"action": "VIEW",
	"environment": {"request_time": "2026-06-01T00:00:00Z", "trace_id": "0af7651916cd43dd8448eb211c80319c"},
}
