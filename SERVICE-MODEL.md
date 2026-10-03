# Service Model

A local service offering is a versioned binding of:

`canonical service + local legal name + tenant + owning organization + provider/jurisdiction resolution + identity policy + eligibility rules + dynamic form + evidence policy + fee schedule + workflow + SLA + notifications + integrations + output/credential + privacy/retention + publication metadata`

Published offerings and dependencies are immutable. New policy creates new versions; in-flight applications continue on pinned versions unless an explicit migration is approved and auditable.


## Signed service package
Published service configuration must be exportable as a signed `.sfpackage` containing the manifest, forms/UI schema, semantic dependencies, rules, workflow, evidence, fees, SLA, access, credential, localization, tests, dependency versions and hashes. Secrets/credentials remain environment-bound references.

## Canonical semantics
Use CMP-058 semantic element IDs for common government data wherever possible. Do not create new aliases for common concepts without checking the registry.


## Presentation contract
Published service metadata is design-system independent. At runtime, ServiceForm maps form/schema controls to the versioned UX4G-backed renderer registry so the same service definition remains portable across React web and Flutter mobile.
