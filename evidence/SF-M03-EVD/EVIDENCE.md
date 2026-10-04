# SF-M03-EVD — independent evidence bind

**Recommended: `G3_INTEGRATION_VERIFIED` (human/CI decides). Not CERTIFIED. Not G6.**

Binder role only. Did not re-patch components. Did not merge sibling drafts. Production SoT remains `origin/main` `7424235592824d5ceda9dcac55380a78c05cb6c5`.

| Field | Value |
|---|---|
| Task | SF-M03-EVD |
| Production SoT | `7424235592824d5ceda9dcac55380a78c05cb6c5` |
| INT PR / head | [#59](https://github.com/dbn1972/serviceform-ai/pull/59) `facb0fe72aa674364f14a3f372591866929d54e7` |
| INT local run | `local-m03-int-rerun` / `independent-m03-integration` @ `2026-10-04T11:54:50Z` |
| INT local catalog SHA | `9a782b8a6ea4b03aad7ccd31b246231ab2c7ea24` |
| SEC PR / head | [#61](https://github.com/dbn1972/serviceform-ai/pull/61) `8c859f25113cef4590d79886c8a77e1e7e8e4b3d` |
| SEC probe SHA | `1efeac0030bf86a0861661c5ddeb2ba3b909a580` |
| SEC assessed_at | `2026-10-04T12:07:56.168Z` |
| #60 test split | [#60](https://github.com/dbn1972/serviceform-ai/pull/60) `4f784b936ab8e3bc1a5e43226ce9310269463299` |
| `CROSS_TENANT_LEAKAGE` | **0** (INT and SEC) |
| Frozen contracts | **13/13 MATCH** (INT and SEC) |
| CMP-001 INT | **8/8** |
| Pin INSERT | **`42501`** (fresh txn; INT after #60 split; SEC independent) |
| Recommended gate | `G3_INTEGRATION_VERIFIED` |
| `certified` | **false** |
| Envelope | `READY` / `dispatched: false` |

Primary narrative: `docs/verification/M03-G3-RECOMMENDATION.md`.
