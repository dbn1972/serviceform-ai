package sf.authz

import rego.v1

default allow := false

decision := {
	"allow": allow,
	"reason_code": reason_code,
	"policy_revision": object.get(data.sf.meta, "policy_revision", "none"),
}

allow if reason_code == "ALLOW"

reason_code := first_deny if first_deny != ""

reason_code := "ALLOW" if first_deny == ""

default missing_input := true

default unknown := true

default no_data := true

default no_role := true

missing_input := false if input_present

unknown := false if action_known

no_data := false if tenant_data_present

no_role := false if role_permits

codes := [c |
	some pair in [
		{"on": missing_input, "code": "INPUT_MISSING"},
		{"on": unknown, "code": "UNKNOWN_ACTION"},
		{"on": tenant_mismatch, "code": "TENANT_MISMATCH"},
		{"on": no_data, "code": "POLICY_DATA_MISSING"},
		{"on": no_role, "code": "ROLE_NOT_PERMITTED"},
		{"on": org_mismatch, "code": "ORG_MISMATCH"},
		{"on": office_mismatch, "code": "OFFICE_MISMATCH"},
		{"on": service_out_of_scope, "code": "SERVICE_OUT_OF_SCOPE"},
		{"on": jurisdiction_denied, "code": "JURISDICTION_DENIED"},
		{"on": time_required_missing, "code": "REQUEST_TIME_MISSING"},
		{"on": delegation_reason != "", "code": delegation_reason},
		{"on": workflow_mismatch, "code": "WORKFLOW_MISMATCH"},
		{"on": privileged_reason != "", "code": privileged_reason},
	]
	pair.on
	c := pair.code
	c != ""
]

first_deny := codes[0] if count(codes) > 0

first_deny := "" if count(codes) == 0
