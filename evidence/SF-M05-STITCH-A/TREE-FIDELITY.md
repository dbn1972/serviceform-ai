# Tree fidelity vs frozen inputs (SF-M05-STITCH-A)

Execution base: `df028c71035d584601e1c6a860c75d7bb7d2bd22`  
Method: `git checkout <frozen_sha> -- <component tree + migrations>` then blob SHA + aggregate SHA256 of concatenated file bytes in path-sorted order.

| Component | Frozen input | Tracked files | Aggregate SHA256 | Result |
|---|---|---:|---|---|
| CMP-015 | `2d68e37c3e01d78129f1604b02fe98bae4048489` | 52 | `6aa8dacbe556a165c7507bbf31ecf14ca0b313df96c0683bf309a74ea9a2d514` | MATCH BYTE_IDENTICAL |
| CMP-016 | `9249ecb7ec2c3e33c0aff139c1496cf7b80c7ce9` | 54 | `483dc9dfa834975a3f62e5ea936e5fddde260a3a87b22fad912714b2a92dddbd` | MATCH BYTE_IDENTICAL |
| CMP-017 | `8641c756b539492e3f90d2b04c8a9eb1f2192175` | 48 | `33afd3d5b8db89666ab7ea3bab28f22e18574d8dead8478179fd9da4b5d0cb7b` | MATCH BYTE_IDENTICAL |
| CMP-029 | `5c4d8ac700364b8b01fa10a44f8a1b049b3da825` | 41 | `e7020f45b08568e86b7fa6bb28759420045a5831b158554e0b4d42147543b906` | MATCH BYTE_IDENTICAL |

Semantic source changes: **0**. Migration semantic changes: **0**. Contract changes: **0**. Formatting changes: **0**. Blob mismatches: **0**.

`BYTE_IDENTICAL_TO_FROZEN_INPUTS` = **true** excluding root `pnpm-lock.yaml` and `evidence/SF-M05-STITCH-A/**` / `orchestrator/handovers/SF-M05-STITCH-A.yaml`.
