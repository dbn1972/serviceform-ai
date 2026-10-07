# Tree fidelity vs frozen inputs (SF-M05-STITCH-B)

Execution base: `ca57057a794739c03d0a46886577e25adf041815`  
Method: `git checkout <frozen_sha> -- <component tree + migrations>` then aggregate SHA256 of concatenated file bytes in path-sorted order. Worktree bytes compared to `git show <sha>:<path>`.

| Component | Frozen input | Tracked files | Aggregate SHA256 | Result |
|---|---|---:|---|---|
| CMP-018 | `1ca2dbccb2702d40b28f46cab7717bf3fc36d4d7` | 55 | `7e95a9421d9662ccb9621581bd9b62e76b3ff12f107f9e4c5890b50322f16fe6` | MATCH BYTE_IDENTICAL |
| CMP-019 | `b36715f83c1c2aaa47c6d9b54c568959c131db50` | 40 | `b5ba031f38db6747426e6b2f733a1d30ebaf79a2157873c4da2adb4a8def5c1e` | MATCH BYTE_IDENTICAL |
| CMP-027 | `f4208a1d446ccd5e7b707a9f5942481d24630278` | 41 | `ceaa9953831c15dd0115c9ba513cb13eee0ff2b1e7d63395f6e237dc28d351fa` | MATCH BYTE_IDENTICAL |
| CMP-028 | `1a6a1ee2e128b1c0eda8fe411d798287063eed5b` | 47 | `4ef2e5bf26316bd6306680969be4237f11d1c61082a9861c5ed03d28222500b3` | MATCH BYTE_IDENTICAL |

Semantic source changes: **0**. Migration semantic changes: **0**. Contract changes: **0**. Formatting changes: **0**. Blob mismatches: **0**.

`BYTE_IDENTICAL_TO_FROZEN_INPUTS` = **true** excluding root `pnpm-lock.yaml` and `evidence/SF-M05-STITCH-B/**` / `orchestrator/handovers/SF-M05-STITCH-B.yaml`.
