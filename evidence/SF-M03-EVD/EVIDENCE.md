# SF-M03-EVD — M03 G3 issuance bind

**Issued: `G3_INTEGRATION_VERIFIED` (module-exit only). Not CERTIFIED. Not G6.**

Human/CI issued the gate. This directory records the bind. Recording agent `self_certified: false`. Production SoT remains `7424235592824d5ceda9dcac55380a78c05cb6c5`. Test-only #60 landed at `bd5799b5a784e0e7e6360040cba1c2eda1522c6d`.

| Field | Value |
|---|---|
| Task | SF-M03-EVD (record only; envelope `READY` / `dispatched: false`) |
| Production SoT | `7424235592824d5ceda9dcac55380a78c05cb6c5` |
| INT PR / head | [#59](https://github.com/dbn1972/serviceform-ai/pull/59) `facb0fe72aa674364f14a3f372591866929d54e7` (unmerged) |
| INT local run | `local-m03-int-rerun` / `independent-m03-integration` @ `2026-10-04T11:54:50Z` |
| SEC PR / head | [#61](https://github.com/dbn1972/serviceform-ai/pull/61) `8c859f25113cef4590d79886c8a77e1e7e8e4b3d` (unmerged) |
| #60 test split head | `4f784b936ab8e3bc1a5e43226ce9310269463299` |
| #60 merge SHA | `bd5799b5a784e0e7e6360040cba1c2eda1522c6d` |
| `CROSS_TENANT_LEAKAGE` | **0** |
| Frozen contracts | **13/13** |
| CMP-001 INT | **8/8** |
| Pin INSERT | **`42501`** |
| Issued gate | `G3_INTEGRATION_VERIFIED` |
| `gate_issued` / `gate_ready` / `gate_passed` | **true** |
| `certified` / `release_certified` / `g6_claimed` | **false** |
| M04 | **BLOCKED** (M02 G3 pending) |

Primary narrative: `docs/verification/M03-G3-RECOMMENDATION.md`. Machine record: `orchestrator/handovers/M03-GATE.yaml`.
