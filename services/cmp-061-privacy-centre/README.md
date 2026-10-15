# CMP-061 Citizen Privacy & Data Rights Centre

SF-M09-006 · INT-019 · INT-011 · schema `sf_privacy` · role `sf_cmp061_rw`

Orchestrates citizen privacy rights requests (`SF-CON-PRIVACY-REQUEST`). The Centre stores the request, declared scope, one fulfilment task per scope item, and an insert-only decision log. **Owning components** execute access/correction/erasure/portability/consent changes and attest outcomes. CMP-061 never reads or writes another component's tables (`cross_component_direct_mutation_forbidden`, `owner_task_orchestration_only`).

No privacy statute is encoded: legal bases / exceptions are opaque owner-supplied refs (`POLICY_INPUT_REQUIRED`).

## Not in this PR

- Host mount (`SF-M09-HOST`)
- `pnpm-lock.yaml` (STITCH-A residual)
- Consent history SQL against CMP-030 (port only)
- CERTIFIED / G4 / G6
