# ADR-0008: Trusted BFF hop for client address (rate limits)

| Field | Value |
|---|---|
| Status | **PROPOSED** — non-production / SAMPLE_LAB use authorized under Phase B F-08; production acceptance requires the owner |
| Proposed by | Phase B F-08 trusted-proxy agent, 20 November 2026 |
| Date | 20 November 2026 |
| Changes | Host `trustProxy` config + portal BFF forwarding of observed client address. No frozen contract hash changes. No new datastore. DigiLocker remains SIMULATED. |

## Context

SEC finding **F-08** (Medium): CMP-004 (and related) HTTP rate limits key on `request.ip`. With Fastify `trustProxy: false`, every portal request shares the BFF's address, so one client can exhaust the shared bucket and there is no per-client brute-force bound at the edge (compounds the earlier F-06 channel budget). Client-supplied `X-Forwarded-For` is correctly ignored today, which prevents bucket rotation by forgery but also prevents legitimate per-client keys.

## Decision

### D-1 Explicit trusted hops only

`SF_TRUSTED_PROXY_HOPS` is a comma-separated list of BFF hop IPs/CIDRs. Empty/unset → `trustProxy: false` (current secure default). The host never accepts `*`, `true`, `0.0.0.0/0`, or `::/0`. PRODUCTION refuses loopback-only hops. SAMPLE_LAB/LOCAL/CI may set `127.0.0.1,::1` when the BFF and API share a host.

### D-2 BFF forwards the observed client address

Portal BFFs set `X-Forwarded-For` to the address they observed for the browser hop when calling the platform. They do not forward arbitrary client header chains as tenant or identity claims (SF-TEN-002 unchanged). When the BFF cannot observe an address, it omits the header and the peer address remains the rate-limit key.

### D-3 Rate-limit keys stay on `request.ip`

CMP-004 / CMP-036 / related limiters continue to key on Fastify `request.ip`. With D-1 enabled, that value is the trusted client address. Per-channel OTP failure budget (F-06) remains separate. Product trade-offs for combining per-(number, client) budgets (N-3) stay **PROPOSED** options — not decided here.

## Consequences

- Per-client OTP/auth rate limits work once the BFF hop is configured and the BFF forwards the observed address.
- Direct callers that are not a trusted hop still cannot rotate buckets via forged `X-Forwarded-For`.
- SAMPLE_LAB remains usable with the raised shared limit when hops are unset; enabling hops is documented, not forced.
- Independent SEC re-verify should confirm both modes before REAL OTP or external users.
- **CERTIFIED=false · G6=false · self_certified=false**. ADR-0007 is not accepted by this change. `SF_M10_UX4G_READY` is not set.

## N-3 options (PROPOSED — product, not accepted here)

1. Escalating or per-(number, client) failure budget once trusted client address is available.
2. Operator unlock for a throttled channel.
3. Alerting on sustained per-number throttling.

## Alternatives considered

- `trustProxy: true` globally — rejected (any client can forge XFF).
- Trust hop count (`trustProxy: 1`) — rejected (trusts any single peer, not a named BFF).
- Key only on channel — insufficient for DoS of the shared IP bucket; F-06 already covers channel budget.
