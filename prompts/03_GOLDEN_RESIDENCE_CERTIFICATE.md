# Cursor Task - Golden Residence Certificate

Implement the Golden Vertical Slice only after prerequisite modules pass their gates.

Requirements:
- Create the Residence Certificate through ServiceForm Studio metadata/configuration, not a bespoke backend service.
- Create canonical template + tenant overlay + published TenantServiceBinding.
- Exercise citizen OTP (SIMULATED/SANDBOX in non-prod), profile/claims, discovery, eligibility, dynamic form, evidence, submit, optional payment, workflow, OPA-authorized officer task, deficiency loop, verification, approval/rejection, signing, credential, QR, DigiLocker simulation and notification sinks.
- Validate PostgreSQL FORCE RLS with negative cross-tenant tests.
- Validate durable state commit before Temporal signal.
- Validate payment only after durable application creation.
- Validate technical evidence acceptance separately from business verification.
- Produce E2E evidence and do not claim certification without executed results.
