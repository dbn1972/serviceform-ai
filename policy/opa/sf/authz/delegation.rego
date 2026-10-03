package sf.authz

import rego.v1

default delegation_reason := ""

delegation_id := object.get(input.subject, "delegation_id", null)

delegation_record := object.get(object.get(data.sf.tenants[tenant_key], "delegations", {}), delegation_id, null)

default has_delegation := false

default has_record := false

default delegate_matches := false

default revoked := false

default needs_approval := false

default started := false

default expired := false

default action_delegated := false

default delegator_has_action := false

default unknown_del := false

default bad_subject := false

default del_time_missing := false

default not_started := false

default is_expired := false

default not_action := false

default not_authority := false

has_delegation if delegation_id != null

has_record if delegation_record != null

delegate_matches if {
	has_record
	delegation_record.delegate_user_id == input.subject.user_id
}

request_time_present if object.get(object.get(input, "environment", {}), "request_time", "") != ""

started if {
	time.parse_rfc3339_ns(input.environment.request_time) >= time.parse_rfc3339_ns(delegation_record.starts_at)
}

expired if {
	time.parse_rfc3339_ns(input.environment.request_time) >= time.parse_rfc3339_ns(delegation_record.ends_at)
}

revoked if {
	has_record
	delegation_record.status == "REVOKED"
}

needs_approval if {
	has_record
	delegation_record.approval_required == true
	not delegation_record.approved_by
}

action_delegated if {
	has_record
	input.action in object.get(delegation_record, "actions", [])
}

delegator_has_action if {
	some role, entry in object.get(data.sf.tenants[tenant_key], "roles", {})
	input.action in object.get(entry, "actions", [])
	role
}

unknown_del if {
	has_delegation
	not has_record
}

unknown_del := false if has_record

unknown_del := false if not has_delegation

bad_subject if {
	has_record
	not delegate_matches
}

bad_subject := false if delegate_matches

bad_subject := false if not has_record

del_time_missing if {
	has_record
	delegate_matches
	not request_time_present
}

del_time_missing := false if request_time_present

del_time_missing := false if not has_record

not_started if {
	has_record
	delegate_matches
	request_time_present
	not started
}

not_started := false if started

not_started := false if not has_record

is_expired if {
	has_record
	delegate_matches
	expired
}

is_expired := false if {
	has_record
	not expired
}

is_expired := false if not has_record

not_action if {
	has_record
	not action_delegated
}

not_action := false if action_delegated

not_action := false if not has_record

not_authority if {
	has_record
	not delegator_has_action
}

not_authority := false if delegator_has_action

not_authority := false if not has_record

del_codes := [c |
	some pair in [
		{"on": unknown_del, "code": "DELEGATION_UNKNOWN"},
		{"on": bad_subject, "code": "DELEGATION_SUBJECT"},
		{"on": del_time_missing, "code": "REQUEST_TIME_MISSING"},
		{"on": not_started, "code": "DELEGATION_NOT_STARTED"},
		{"on": is_expired, "code": "DELEGATION_EXPIRED"},
		{"on": revoked, "code": "DELEGATION_REVOKED"},
		{"on": needs_approval, "code": "DELEGATION_UNAPPROVED"},
		{"on": not_action, "code": "DELEGATION_ACTION"},
		{"on": not_authority, "code": "DELEGATION_AUTHORITY"},
	]
	pair.on
	c := pair.code
]

delegation_reason := del_codes[0] if count(del_codes) > 0

delegation_reason := "" if count(del_codes) == 0
