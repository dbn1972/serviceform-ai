# Security Baseline

Security verification targets OWASP ASVS 5.0.0 concepts plus Government of India/CERT-In/GIGW requirements applicable to the deployment.

## Required controls
- OIDC/OAuth-based authentication; MFA/step-up for privileged official operations.
- Server-side RBAC + ABAC using tenant/org/office/jurisdiction/role/service/action/case relationship.
- RLS/tenant isolation tests and IDOR-negative tests.
- Short-lived credentials; secrets in approved secret/KMS systems.
- Strict input/schema validation, output encoding, secure headers and CSRF protections where relevant.
- SSRF-safe outbound integration layer with allowlists and egress controls.
- Signed/audited privileged actions; tamper-evident audit trail.
- SAST, dependency, secret and IaC scanning in CI.
- PII/logging redaction and structured audit event separation.
- Malware scanning/quarantine for uploads; content-type verification and checksum.
- Threat-model delta for material capabilities.
