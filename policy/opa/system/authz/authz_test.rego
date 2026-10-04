package system.authz_test

import data.system.authz
import rego.v1

test_grant_publisher_sf_runtime if {
	authz.allow with input as {"identity": "grant-publisher", "method": "PUT", "path": ["v1", "data", "sf_runtime", "privileged_grants", "x"]}
}

test_grant_publisher_cannot_write_tenants if {
	not authz.allow with input as {"identity": "grant-publisher", "method": "PUT", "path": ["v1", "data", "sf", "tenants"]}
}

test_pep_may_post_decision if {
	authz.allow with input as {"identity": "pep", "method": "POST", "path": ["v1", "data", "sf", "authz", "decision"]}
}

test_unauthenticated_denied if {
	not authz.allow with input as {"identity": "", "method": "POST", "path": ["v1", "data", "sf", "authz", "decision"]}
}
