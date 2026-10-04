# CMP-004 Identity & Access Service

Officer token validation, citizen OTP/session lifecycle, linked identity methods, and account
recovery. Platform machinery only — no statutory eligibility or approval decisions.

Host mount is **SF-M02-003** (`apps/api`). This package exports `registerIdentityAccess` and
`IdentityPrincipalVerifier` for CMP-048.

SIMULATED OTP / IdP / DigiLocker identity ports only. CMP-012 is M07. Production fail-closed
if a critical connector would run SIMULATED.

Not CERTIFIED.
