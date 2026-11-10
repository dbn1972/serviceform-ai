package sf.authz_test

import rego.v1

# CCR-M10-003: M07 issuance and DigiLocker publish actions. They are role-granted only (a tenant
# workload or officer role); no citizen-owner or published grant exists for any of them.

ISSUANCE_ACTOR := "0d15ba00-5a00-4000-8000-0d15ba005a00"

CREDENTIAL := "c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4"

m07_actions := {
	"Credential": ["CREDENTIAL_ISSUE", "CREDENTIAL_READ", "CREDENTIAL_DOWNSTREAM_OUTCOME_RECORD"],
	"CredentialRegistryEntry": ["CREDENTIAL_REGISTRY_REGISTER", "CREDENTIAL_REGISTRY_STATUS_READ"],
	"DigiLockerPublish": ["digilocker:publish", "digilocker:read"],
}

issuance_role := {T1: {"roles": {"ISSUANCE_WORKLOAD": {
	"actions": [a | some actions in m07_actions; some a in actions],
	"resource_types": object.keys(m07_actions),
	"jurisdiction_scope": "TENANT_WIDE",
	"all_services": true,
}}}}

workload_input(resource_type, action) := {
	"subject": {
		"user_id": ISSUANCE_ACTOR,
		"actor_type": "SYSTEM",
		"tenant_id": T1,
		"roles": ["ISSUANCE_WORKLOAD"],
		"jurisdiction_ids": [],
		"assurance": "WORKLOAD_IDENTITY",
	},
	"resource": {
		"resource_type": resource_type,
		"tenant_id": T1,
		"application_id": CREDENTIAL,
		"classification": "TENANT_SCOPED",
	},
	"action": action,
	"environment": {"trace_id": "0af7651916cd43dd8448eb211c80319c"},
}

test_m07_actions_are_known if {
	every _, actions in m07_actions {
		every a in actions {
			data.sf.common.actions[a]
		}
	}
	every rt, _ in m07_actions {
		rt in data.sf.common.resource_types
	}
}

test_workload_role_may_issue_and_publish if {
	every rt, actions in m07_actions {
		every a in actions {
			d := eval(workload_input(rt, a), issuance_role)
			d.allow == true
			d.policy_revision == "m10-c2"
		}
	}
}

test_m07_actions_need_a_role if {
	every rt, actions in m07_actions {
		every a in actions {
			d := eval(workload_input(rt, a), {})
			d.allow == false
			d.reason_code == "ROLE_NOT_PERMITTED"
		}
	}
}

test_m07_actions_not_granted_to_unlisted_role if {
	inp := json.patch(workload_input("Credential", "CREDENTIAL_ISSUE"), [
		{"op": "replace", "path": "/subject/roles", "value": ["SOME_OTHER_ROLE"]},
	])
	d := eval(inp, issuance_role)
	d.allow == false
	d.reason_code == "ROLE_NOT_PERMITTED"
}

test_m07_actions_never_citizen_owned if {
	every rt, actions in m07_actions {
		every a in actions {
			inp := json.patch(workload_input(rt, a), [
				{"op": "replace", "path": "/subject/actor_type", "value": "CITIZEN"},
				{"op": "replace", "path": "/subject/user_id", "value": CITIZEN_A},
				{"op": "replace", "path": "/subject/roles", "value": []},
				{"op": "replace", "path": "/subject/assurance", "value": "OTP"},
				{"op": "add", "path": "/resource/owner_id", "value": CITIZEN_A},
			])
			d := eval(inp, issuance_role)
			d.allow == false
			d.reason_code == "ROLE_NOT_PERMITTED"
		}
	}
}

test_m07_workload_cross_tenant_denied if {
	inp := json.patch(workload_input("DigiLockerPublish", "digilocker:publish"), [
		{"op": "replace", "path": "/resource/tenant_id", "value": T2},
	])
	d := eval(inp, issuance_role)
	d.allow == false
	d.reason_code == "TENANT_MISMATCH"
}

test_m07_action_on_wrong_resource_type_denied if {
	d := eval(workload_input("ApplicationCase", "CREDENTIAL_ISSUE"), issuance_role)
	d.allow == false
	d.reason_code == "ROLE_NOT_PERMITTED"
}
