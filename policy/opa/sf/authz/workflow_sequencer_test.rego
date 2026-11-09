package sf.authz_test

import data.sf.authz
import rego.v1

SEQUENCER_ACTOR := "5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e"

sequencer_role := {T1: {"roles": {"WORKFLOW_SEQUENCER": {
	"actions": ["WORKFLOW_INSTANCE_START", "WORKFLOW_SIGNAL_ADVANCE"],
	"resource_types": ["Application"],
	"jurisdiction_scope": "TENANT_WIDE",
	"all_services": true,
}}}}

sequencer_input := {
	"subject": {
		"user_id": SEQUENCER_ACTOR,
		"actor_type": "SYSTEM",
		"tenant_id": T1,
		"roles": ["WORKFLOW_SEQUENCER"],
		"jurisdiction_ids": [],
		"assurance": "WORKLOAD_IDENTITY",
	},
	"resource": {
		"resource_type": "Application",
		"tenant_id": T1,
		"classification": "TENANT_SCOPED",
		"application_id": "a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9",
	},
	"action": "WORKFLOW_SIGNAL_ADVANCE",
	"environment": {"request_time": "2026-11-09T10:00:00Z"},
}

seq_eval(inp) := d if {
	d := authz.decision with input as inp with data.sf.tenants as sequencer_role
}

test_sequencer_start_and_advance_allowed if {
	every action in ["WORKFLOW_INSTANCE_START", "WORKFLOW_SIGNAL_ADVANCE"] {
		d := seq_eval(json.patch(sequencer_input, [{"op": "replace", "path": "/action", "value": action}]))
		d.allow == true
	}
}

test_sequencer_other_tenant_denied if {
	d := seq_eval(json.patch(sequencer_input, [{"op": "replace", "path": "/resource/tenant_id", "value": T2}]))
	d.allow == false
	d.reason_code == "TENANT_MISMATCH"
}

test_sequencer_cannot_decide_or_mutate_case if {
	every action in ["APPLICATION_RECORD_APPROVED", "APPLICATION_MARK_RECEIVED", "WORKFLOW_VERSION_PUBLISH"] {
		d := seq_eval(json.patch(sequencer_input, [{"op": "replace", "path": "/action", "value": action}]))
		d.allow == false
	}
}

test_sequencer_role_limited_to_application_resource if {
	d := seq_eval(json.patch(sequencer_input, [{"op": "replace", "path": "/resource/resource_type", "value": "ApplicationCase"}]))
	d.allow == false
	d.reason_code == "ROLE_NOT_PERMITTED"
}

test_advance_without_sequencer_role_denied if {
	d := seq_eval(json.patch(sequencer_input, [{"op": "replace", "path": "/subject/roles", "value": []}]))
	d.allow == false
	d.reason_code == "ROLE_NOT_PERMITTED"
}
