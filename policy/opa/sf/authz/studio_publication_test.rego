package sf.authz_test

import rego.v1

# SF-M10-C-1: CMP-033 metadata, CMP-051 maker-checker and CMP-052 versioning actions are catalogued
# and role-granted only. Maker and checker are separate roles; no citizen grant exists for any of
# them. CMP-051 still refuses a decision by the maker independently of OPA.

STUDIO_MAKER := "0d15ba00-0f02-4000-8000-0d15ba000f02"

studio_actions := {
	"MetadataDocument": [
		"METADATA_DOCUMENT_CREATE",
		"METADATA_DOCUMENT_READ",
		"METADATA_DOCUMENT_UPDATE",
		"METADATA_DOCUMENT_VALIDATE",
		"METADATA_DOCUMENT_PUBLISH",
	],
	"MetadataBundle": ["METADATA_BUNDLE_COMPOSE"],
	"PublicationRequest": [
		"PUBLICATION_REQUEST_CREATE",
		"PUBLICATION_REQUEST_READ",
		"PUBLICATION_REQUEST_SUBMIT",
		"PUBLICATION_REQUEST_APPROVE",
		"PUBLICATION_REQUEST_REJECT",
	],
	"TenantServiceBinding": [
		"TENANT_SERVICE_BINDING_CREATE",
		"TENANT_SERVICE_BINDING_READ",
		"TENANT_SERVICE_BINDING_UPDATE",
		"TENANT_SERVICE_BINDING_PUBLISH",
	],
	"ArtifactVersion": ["ARTIFACT_VERSION_READ"],
}

maker_actions := [
	"METADATA_DOCUMENT_CREATE",
	"METADATA_DOCUMENT_READ",
	"METADATA_DOCUMENT_VALIDATE",
	"METADATA_DOCUMENT_PUBLISH",
	"PUBLICATION_REQUEST_CREATE",
	"PUBLICATION_REQUEST_SUBMIT",
	"TENANT_SERVICE_BINDING_CREATE",
	"TENANT_SERVICE_BINDING_READ",
	"FORM_INTERPRET",
]

checker_actions := [
	"METADATA_DOCUMENT_READ",
	"PUBLICATION_REQUEST_READ",
	"PUBLICATION_REQUEST_APPROVE",
	"PUBLICATION_REQUEST_REJECT",
	"TENANT_SERVICE_BINDING_READ",
	"TENANT_SERVICE_BINDING_PUBLISH",
	"FORM_INTERPRET",
]

studio_roles := {T1: {"roles": {
	"STUDIO_DESIGNER": {
		"actions": maker_actions,
		"resource_types": ["MetadataDocument", "PublicationRequest", "TenantServiceBinding", "FormDefinition"],
		"jurisdiction_scope": "TENANT_WIDE",
		"all_services": true,
	},
	"STUDIO_CHECKER": {
		"actions": checker_actions,
		"resource_types": ["MetadataDocument", "PublicationRequest", "TenantServiceBinding", "FormDefinition"],
		"jurisdiction_scope": "TENANT_WIDE",
		"all_services": true,
	},
}}}

studio_input(role, resource_type, action) := {
	"subject": {
		"user_id": STUDIO_MAKER,
		"actor_type": "OFFICER",
		"tenant_id": T1,
		"roles": [role],
		"jurisdiction_ids": [],
		"assurance": "IDP",
	},
	"resource": {
		"resource_type": resource_type,
		"tenant_id": T1,
		"classification": "TENANT_SCOPED",
	},
	"action": action,
	"environment": {"trace_id": "0af7651916cd43dd8448eb211c80319c"},
}

test_studio_actions_are_known if {
	every _, actions in studio_actions {
		every a in actions {
			data.sf.common.actions[a]
		}
	}
	every rt, _ in studio_actions {
		rt in data.sf.common.resource_types
	}
}

test_reads_are_read_only_and_writes_protected if {
	data.sf.common.actions.METADATA_DOCUMENT_READ.action_class == "READ_ONLY"
	data.sf.common.actions.PUBLICATION_REQUEST_READ.action_class == "READ_ONLY"
	data.sf.common.actions.TENANT_SERVICE_BINDING_READ.action_class == "READ_ONLY"
	data.sf.common.actions.METADATA_DOCUMENT_PUBLISH.action_class == "PROTECTED"
	data.sf.common.actions.PUBLICATION_REQUEST_APPROVE.action_class == "PROTECTED"
	data.sf.common.actions.TENANT_SERVICE_BINDING_PUBLISH.action_class == "PROTECTED"
}

test_maker_may_author_freeze_and_request if {
	d := eval(studio_input("STUDIO_DESIGNER", "MetadataDocument", "METADATA_DOCUMENT_PUBLISH"), studio_roles)
	d.allow == true
	d.policy_revision == "m10-c3"
	eval(studio_input("STUDIO_DESIGNER", "PublicationRequest", "PUBLICATION_REQUEST_SUBMIT"), studio_roles).allow == true
	eval(studio_input("STUDIO_DESIGNER", "FormDefinition", "FORM_INTERPRET"), studio_roles).allow == true
}

test_maker_role_cannot_approve_or_publish_binding if {
	d := eval(studio_input("STUDIO_DESIGNER", "PublicationRequest", "PUBLICATION_REQUEST_APPROVE"), studio_roles)
	d.allow == false
	d.reason_code == "ROLE_NOT_PERMITTED"
	b := eval(studio_input("STUDIO_DESIGNER", "TenantServiceBinding", "TENANT_SERVICE_BINDING_PUBLISH"), studio_roles)
	b.allow == false
}

test_checker_may_decide_and_publish_but_not_author if {
	eval(studio_input("STUDIO_CHECKER", "PublicationRequest", "PUBLICATION_REQUEST_APPROVE"), studio_roles).allow == true
	eval(studio_input("STUDIO_CHECKER", "TenantServiceBinding", "TENANT_SERVICE_BINDING_PUBLISH"), studio_roles).allow == true
	d := eval(studio_input("STUDIO_CHECKER", "MetadataDocument", "METADATA_DOCUMENT_CREATE"), studio_roles)
	d.allow == false
	d.reason_code == "ROLE_NOT_PERMITTED"
}

test_studio_actions_deny_without_role_or_in_other_tenant if {
	every rt, actions in studio_actions {
		every a in actions {
			eval(studio_input("STUDIO_DESIGNER", rt, a), {}).allow == false
		}
	}
	other := json.patch(studio_input("STUDIO_DESIGNER", "MetadataDocument", "METADATA_DOCUMENT_READ"), [
		{"op": "replace", "path": "/resource/tenant_id", "value": T2},
	])
	d := eval(other, studio_roles)
	d.allow == false
	d.reason_code == "TENANT_MISMATCH"
}

# SF-M10-C-2: CMP-016 Studio authoring actions (checks, BPMN profile, DRAFT emission).
workflow_studio_actions := [
	"WORKFLOW_DEFINITION_CREATE",
	"WORKFLOW_VERSION_DRAFT",
	"WORKFLOW_VERSION_IMPORT_BPMN",
	"WORKFLOW_VERSION_EXPORT_BPMN",
]

workflow_role := {T1: {"roles": {"STUDIO_DESIGNER": {
	"actions": workflow_studio_actions,
	"resource_types": ["WorkflowDefinition", "WorkflowVersion"],
	"jurisdiction_scope": "TENANT_WIDE",
	"all_services": true,
}}}}

test_workflow_studio_actions_known_and_role_granted if {
	every a in workflow_studio_actions {
		data.sf.common.actions[a]
		eval(studio_input("STUDIO_DESIGNER", "WorkflowDefinition", a), workflow_role).allow == true
		eval(studio_input("STUDIO_DESIGNER", "WorkflowDefinition", a), {}).allow == false
	}
	"WorkflowDefinition" in data.sf.common.resource_types
	"WorkflowVersion" in data.sf.common.resource_types
}

test_workflow_publish_not_granted_to_designer if {
	d := eval(studio_input("STUDIO_DESIGNER", "WorkflowVersion", "WORKFLOW_VERSION_PUBLISH"), workflow_role)
	d.allow == false
}

# SF-M10-C-3: Studio rule-pack test bench (CMP-008 ZEN engine, nothing persisted).
test_rule_pack_test_is_read_only_and_role_granted if {
	data.sf.common.actions.RULE_PACK_TEST.action_class == "READ_ONLY"
	"RulePack" in data.sf.common.resource_types
	grant := {T1: {"roles": {"STUDIO_DESIGNER": {
		"actions": ["RULE_PACK_TEST"],
		"resource_types": ["RulePack"],
		"jurisdiction_scope": "TENANT_WIDE",
		"all_services": true,
	}}}}
	eval(studio_input("STUDIO_DESIGNER", "RulePack", "RULE_PACK_TEST"), grant).allow == true
	eval(studio_input("STUDIO_DESIGNER", "RulePack", "RULE_PACK_TEST"), {}).allow == false
	eval(studio_input("STUDIO_DESIGNER", "RulePack", "RULE_EVALUATION_EXECUTE"), grant).allow == false
}
