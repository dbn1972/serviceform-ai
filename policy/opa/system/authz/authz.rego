package system.authz

import rego.v1

default allow := false

# PEP token may only evaluate decisions.
allow if {
	input.identity == "pep"
	input.method == "POST"
	input.path == ["v1", "data", "sf", "authz", "decision"]
}

allow if {
	input.identity == "pep"
	input.method == "GET"
	input.path == ["health"]
}

# Grant publisher writes only under sf_runtime.
allow if {
	input.identity == "grant-publisher"
	input.method in {"PUT", "GET", "PATCH", "DELETE"}
	count(input.path) >= 3
	input.path[0] == "v1"
	input.path[1] == "data"
	input.path[2] == "sf_runtime"
}

# Nobody writes policies.
allow if {
	false
	input.path[1] == "policies"
}
