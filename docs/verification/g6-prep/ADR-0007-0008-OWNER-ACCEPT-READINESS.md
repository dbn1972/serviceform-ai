# ADR-0007 / ADR-0008 — owner accept readiness (draft notes)

**Status of both ADRs: PROPOSED.** Agents do **not** accept, fake-accept, or rewrite Status to ACCEPTED.  
**CERTIFIED=false · G6=false · self_certified=false · production_idp_claimed=false**

Source ADRs:

- [`docs/adr/ADR-0007-citizen-tenant-context-and-portal-session.md`](../../adr/ADR-0007-citizen-tenant-context-and-portal-session.md)
- [`docs/adr/ADR-0008-trusted-bff-proxy-for-rate-limits.md`](../../adr/ADR-0008-trusted-bff-proxy-for-rate-limits.md)
- Index: [`docs/adr/README.md`](../../adr/README.md) — “Only a human approver can accept an ADR.”

Related owner task: **SF-15** (Accept ADR-0007, ADR-0008, and UX4G READY bind).

---

## ADR-0007 readiness (citizen tenant + portal session)

| Decision | Lab evidence already present? | Owner must confirm |
|---|---|---|
| **D-1** Portal-bound tenant context | SAMPLE_LAB host uses portal placement; SF-TEN-002 refuses client tenant headers | Production portal placement config per tenant deploy; no client-supplied tenant |
| **D-2** Citizen-owner OPA path | `citizen_owner_permits` exercised on platform path UAT | Production OPA bundle revision pinned; no tenant-widened citizen grants |
| **D-3** Opaque portal sessions | BFF cookie = CMP-004 opaque token only (lab) | Cookie flags Secure in non-local; revocation via CMP-004 |
| **D-4** Fail-closed outside authorized envs | Host refuses portal-bound citizen resolver when `SF_ENVIRONMENT=PRODUCTION` until accept | Explicit written accept before PRODUCTION composition |

### Accept checklist (owner)

- [ ] Read D-1…D-4 and alternatives; choose accept **or** direct an alternative ADR
- [ ] Confirm cross-tenant “all my applications” remains out of scope (separate ADR)
- [ ] Confirm PRODUCTION may compose portal-bound citizen resolver only after accept
- [ ] Record accept in `docs/adr/README.md` Status column + ADR Status field (human edit)
- [ ] Do **not** treat Keycloak Admin SIM/REST lab UI (#269) as ADR-0007 acceptance

### Not ready / not claimed by agents

- Status remains **PROPOSED** until owner edit
- REAL IdP / SMS for citizens still separate from this ADR’s session model

---

## ADR-0008 readiness (trusted BFF hop for rate limits)

| Decision | Lab evidence already present? | Owner must confirm |
|---|---|---|
| **D-1** Explicit trusted hops only | Phase B F-08 (#239); empty hops → `trustProxy: false` | PRODUCTION hop CIDRs = real BFF addresses (not `*`, not loopback-only) |
| **D-2** BFF forwards observed client address | Portal BFF XFF forwarding implemented for F-08 | Ops verifies BFF observes real client IP behind edge |
| **D-3** Rate-limit keys on `request.ip` | CMP-004 / tenant-users limiters key on `request.ip` | Independent SEC re-verify both modes before REAL OTP / external users |

### N-3 (still PROPOSED product options — not decided by this ADR)

1. Escalating or per-(number, client) failure budget  
2. Operator unlock for throttled channel  
3. Alerting on sustained per-number throttling  

Owner may accept ADR-0008 **without** deciding N-3.

### Accept checklist (owner)

- [ ] Approve D-1…D-3 for production
- [ ] Provide non-loopback `SF_TRUSTED_PROXY_HOPS` for PRODUCTION (see stub)
- [ ] Authorize SEC re-verify of F-08 before REAL OTP
- [ ] Optionally decide N-3 in a follow-up product note
- [ ] Record accept in ADR Status + README (human edit)

**Stub:** [`config-stubs/trusted-proxy.adr0008.env.stub`](./config-stubs/trusted-proxy.adr0008.env.stub)

---

## Agent non-actions

- Do not flip ADR Status to ACCEPTED in this prep PR
- Do not set `SF_M10_UX4G_READY`, `SF_M10_G5_PERF_READY`, or `SF_M10_RESILIENCE_READY`
- Do not claim production IdP or G6 from ADR drafts
