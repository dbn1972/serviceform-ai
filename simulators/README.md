# External Dependency Simulators

Implement provider-compatible adapters for Payment, OTP, SMS, Email, DigiLocker, eSign and Department APIs.

Modes: `REAL | SANDBOX | SIMULATED`.

Rules:
- SIMULATED is allowed in local/CI/dev/performance environments.
- Production deployment must fail if a critical connector is SIMULATED.
- Simulation follows the same ServiceForm domain path as a real provider.
- Payment simulator emits the same callback/event contract and exercises reconciliation/idempotency.
- OTP simulator still exercises challenge creation, expiry, attempt limits, verification and session issuance.
- SMS/Email sink records rendered templates and delivery outcomes without controlling application state.
- Simulated receipts/credentials/messages are visibly marked TEST/SIMULATED and include testRunId.
