package sf.authz_test

import data.sf.authz
import rego.v1

test_tenant_input_present_false_when_action_empty if {
	not authz.input_present with input as {"subject": {}, "resource": {}, "action": ""}
}
