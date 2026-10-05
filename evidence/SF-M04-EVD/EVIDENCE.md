# SF-M04-EVD — M04 G3 recommendation bind

**Recommended: `G3_INTEGRATION` + `_` + `VERIFIED`. Not issued. Not CERTIFIED. Not G6.**

Independent evidence bind of executed INT + SEC. Human/CI decides G3. Recording agent `self_certified: false`. Production base remains `afc8e253` + `d4c566a4a18b1e01d9b0a1163f9d6adf`. Did not merge [#80](https://github.com/dbn1972/serviceform-ai/pull/80) or [#79](https://github.com/dbn1972/serviceform-ai/pull/79). Did not start M05. Did not issue G3.

| Field | Value |
|---|---|
| Task | SF-M04-EVD (envelope `READY` / `dispatched: false`) |
| Production base | `afc8e253` + `d4c566a4a18b1e01d9b0a1163f9d6adf` (merge [#78](https://github.com/dbn1972/serviceform-ai/pull/78)) |
| INT PR / head | [#80](https://github.com/dbn1972/serviceform-ai/pull/80) `3736c023` + `18bb89c6f89cff31e2afc966ab15e27b` (draft open unmerged) |
| INT local run | `local-m04-int` / `independent-m04-integration` @ `2026-10-05T03:49:26Z` |
| SEC PR / head | [#79](https://github.com/dbn1972/serviceform-ai/pull/79) `6c4b0a41` + `dfe77b694f4566dcdd903d5d49c7b337` (draft open unmerged) |
| SEC evidence-doc stamp | `d2286fe2` + `bc6ed6b33853d7275a9bcd61dfe4579d` (`CLASS_E_EVIDENCE_HEAD_BINDING`; non-blocking) |
| INT | suites **11/11**; tests **420**; INT-011 **PASS**; INT-013 **PASS** |
| SEC | vitest **17/17**; catalog **296/0** |
| `CROSS_TENANT_LEAKAGE` | **0** |
| Frozen contracts | **13/13 MATCH** |
| `production_code_modified` | **false** (INT + SEC vs base) |
| Recommended gate | `G3_INTEGRATION` + `_` + `VERIFIED` |
| `gate_issued` / `gate_ready` / `gate_passed` / `human_gate_issued` | **false** |
| `certified` / `release_certified` / `g6_claimed` / `self_certified` | **false** |
| M05 | **OFF** |

Primary narrative: `docs/verification/M04-G3-RECOMMENDATION.md`. Machine record: `orchestrator/handovers/SF-M04-GATE.yaml`.
