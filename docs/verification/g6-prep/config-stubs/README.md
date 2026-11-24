# G6 prep config stubs

Placeholders for **secret names / binding fields only**.  
Copy into a deployment secret store or local `.env` **after** the owner supplies real values.

| File | Connector | Values in git |
|---|---|---|
| `digilocker.real.env.stub` | DigiLocker REAL | Empty / `OWNER_REQUIRED` |
| `sms-otp.real.env.stub` | SMS/OTP REAL | Empty / `OWNER_REQUIRED` |
| `payment.real.env.stub` | Payment REAL/SANDBOX | Empty / `OWNER_REQUIRED` |
| `trusted-proxy.adr0008.env.stub` | ADR-0008 hops | Empty for PRODUCTION |

**Never commit filled credentials.** Lab continues on SIMULATED adapters until bindings and host mounts are owner-authorized.
