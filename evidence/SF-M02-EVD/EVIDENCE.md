# SF-M02-EVD — M02 G3 recommendation bind

**Recommended: `G3_INTEGRATION_VERIFIED`. Not issued. Not CERTIFIED. Not G6.**

Independent evidence bind of executed INT + SEC. Human/CI decides G3. Recording agent `self_certified: false`. Production SoT remains `d2530008bdc04ee941ff8a16535168791a3b804f`. Did not merge [#64](https://github.com/dbn1972/serviceform-ai/pull/64) or [#65](https://github.com/dbn1972/serviceform-ai/pull/65). Did not start M04.

| Field | Value |
|---|---|
| Task | SF-M02-EVD (envelope `READY` / `dispatched: false`) |
| Production SoT | `d2530008bdc04ee941ff8a16535168791a3b804f` |
| INT PR / head | [#64](https://github.com/dbn1972/serviceform-ai/pull/64) `adaed2f17143367d687f501e333aa6f49476804d` (unmerged) |
| INT local run | `local-m02-int` / `independent-m02-integration` @ `5e7d1cff…` |
| SEC PR / head | [#65](https://github.com/dbn1972/serviceform-ai/pull/65) `428124b3772d47d647207da269a28e7f0953f375` (unmerged) |
| SEC probe | `1baa64c77988b99740ccb0f1bab660209583635e` |
| INT suites | **7/7** |
| SEC | vitest **11/11**; catalog **108/0** |
| `CROSS_TENANT_LEAKAGE` | **0** |
| Frozen contracts | **13/13 MATCH** |
| Recommended gate | `G3_INTEGRATION_VERIFIED` |
| `gate_issued` / `gate_ready` / `gate_passed` | **false** |
| `certified` / `release_certified` / `g6_claimed` | **false** |
| M04 | **BLOCKED** (not started) |

Primary narrative: `docs/verification/M02-G3-RECOMMENDATION.md`. Machine record: `orchestrator/handovers/M02-GATE.yaml`.
