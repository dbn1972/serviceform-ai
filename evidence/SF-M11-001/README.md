# SF-M11-001 — Second-service reuse start (Income Certificate, SAMPLE_LAB)

| Field | Value |
|---|---|
| Module | M11 Reuse Proof with Second Service |
| Stamp | SAMPLE_LAB · DigiLocker **SIMULATED** · **CERTIFIED=false · G6=false · self_certified=false** |
| Tip base | `41227bbebe71b6b7a48aa016e259ea79315dc8ca` (Phase C live pins) |
| CCR | `docs/change-requests/CCR-M11-001-catalogue-generic-portal-projection.md` |

## Goal

Prove as much of M11 as possible **without inventing** Income Certificate statutory policy:
config-only Studio authoring shell + catalogue-generic portal projection + explicit owner blockers.

## Delivered

1. **Income authoring shell** `templates/income-certificate/` — all policy YAML
   `POLICY_INPUT_REQUIRED`; form schema aligned to registry core fields in the catalogue stub.
2. **Stub catalogue** points `authoring_path` at that shell; maturity remains `SAMPLE_LAB_STUB`
   (DRAFT, not in placement).
3. **Owner blocker inventory** `fixtures/m11/ind-soc-031/POLICY_INPUT_REQUIRED.md`.
4. **CCR-M11-001** — citizen/officer portals no longer hard-code IND-SOC-002 for projection /
   empty CTA / queue copy; `isOffered` also refuses `POLICY_INPUT_REQUIRED` policy.
5. **Tests** — unit (catalogue resolve, Income gated) + e2e (`tests/e2e/m11-second-service-reuse.spec.ts`).

## Not delivered (owner blockers)

- Citizen apply / officer decide / issuance E2E for IND-SOC-031 (requires owner policy package).
- Publishing Income as a TenantServiceBinding on SAMPLE_LAB placement.
- G3 module exit / CERTIFIED / G6.

## Honesty

No Odisha or other State Income eligibility, fee, SLA, or DigiLocker registration was invented.
DigiLocker remains SIMULATED. Agents do not self-certify.
