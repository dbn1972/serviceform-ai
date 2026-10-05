# Architecture Decision Records

| ADR | Title | Status |
|---|---|---|
| [ADR-0001](ADR-0001-canonical-build-sequence.md) | Canonical executable build sequence | ACCEPTED (3 Oct 2026) |
| [ADR-0002](ADR-0002-canonical-event-envelope.md) | Canonical wire envelopes use the AWS v1.7 snake_case field set | ACCEPTED (3 Oct 2026) |
| [ADR-0003](ADR-0003-withdrawal-cancellation-request-states.md) | Withdrawal/cancellation request constructs are not CMP-015 states | **PROPOSED** (not ACCEPTED; human-only) |
| [ADR-0004](ADR-0004-greenfield-repository.md) | Greenfield repository; earlier codebase is reference only | ACCEPTED (3 Oct 2026) |
| [ADR-0005](ADR-0005-authorization-policy-version-for-in-flight-cases.md) | Runtime authorization uses current effective published policy | **PROPOSED** (not ACCEPTED; human-only) |
| [ADR-0006](ADR-0006-per-component-write-roles.md) | Per-component database write roles | ACCEPTED (3 Oct 2026, Option A + ten privilege-layer conditions) |

ADR-0003 and ADR-0005 remain **PROPOSED**. They are written from
`docs/audits/ARCHITECTURE-VERIFICATION-001.md` findings M-02 and M-03. This listing does **not**
accept them. Only a human approver can accept an ADR. UX4G as the only UI base remains an open
item, not ADR-0006.
