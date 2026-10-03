# ADR-0004: This repository is a greenfield implementation; the earlier codebase is reference only

| Field | Value |
|---|---|
| Status | **ACCEPTED** |
| Accepted by | Debabrata Nayak (owner), 3 October 2026, in the ServiceFormAi project thread ("yes i accept", 10:26 UTC, replying to Claude's recommendation to accept ADR-0001, ADR-0002, ADR-0004 and CONTRACT-REVIEW-001 D-01 to D-05 and freeze the 13 contracts); recorded by Claude |
| Date | 3 October 2026 |
| Proposed by | Claude (M00 bootstrap), from ARCHITECTURE-VERIFICATION-001 finding H-06 |
| Changes | Starting point only. The frozen stack and constitution are unchanged. |

## Context

The owner's existing GitHub repository (`dbn1972/serviceformai`) is a NestJS + TypeORM +
React/Vite + MUI codebase with application-level tenant filtering and no OPA, GoRules or Temporal.
Package v2.5 and AWS v1.7 fix a different stack (Fastify, Next.js, Flutter, UX4G, PostgreSQL FORCE
RLS, OPA, GoRules, Temporal). ARCHITECTURE-VERIFICATION-001 (H-06) made bootstrap conditional on
the owner choosing a starting point. On 3 October 2026 the owner accepted the verification and
instructed that the Fastify and Next.js foundation be bootstrapped in this repository.

## Decision

1. This repository is the implementation of record and starts greenfield (M00 bootstrap).
2. `dbn1972/serviceformai` is frozen as a prototype and is read-only reference input.
3. Anything taken from it (for example validation rules, service manifests, E2E journeys, entity
   shapes) is ported through a normal build-plan task with review, tests and evidence, never
   copied wholesale.

## Consequences

- No NestJS, TypeORM, Vite or MUI dependency enters this repository without a new ADR; the
  design-system gate already rejects MUI.
- Port tasks cite the source file and commit of the reference repository in their evidence.
