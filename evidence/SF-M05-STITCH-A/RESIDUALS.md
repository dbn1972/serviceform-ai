# Residuals (not certification)

- `@swc/core@1.16.12` install scripts ignored by root `onlyBuiltDependencies` (read-only). Temporal tests 12/12 still passed using prebuilt optional packages.
- Isolated builder evidence path `evidence/SF-M05-004/**` is written by CMP-029 vitest config; stitch copied junit into `evidence/SF-M05-STITCH-A/junit/` and did not commit the builder path.
- PR #91 remains permanently stale and was not reused.
- Wave B / SF-M05-005..009 / STITCH-B / INT / SEC / EVD / M06 / M08 remain OFF.
- This stitch is **not** CERTIFIED, not G4, not G6, not self-certified. Do not merge until exact-candidate-head CI + Security + Developer-platform are SUCCESS and a human/CI gate accepts.
