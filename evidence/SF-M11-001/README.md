# SF-M11-001 — Second-service reuse (Income Certificate, SAMPLE_LAB)

| Field | Value |
|---|---|
| Module | M11 Reuse Proof with Second Service |
| Stamp | SAMPLE_LAB · DigiLocker **SIMULATED** · **CERTIFIED=false · G6=false · self_certified=false** |
| Tip base | `41227bbebe71b6b7a48aa016e259ea79315dc8ca` (Phase C live pins) |
| SF-61 polish | Path/fixtures + Studio DUMMY designer starters (see `evidence/SF-61-M11-INCOME-POLISH/`) |
| CCR | `docs/change-requests/CCR-M11-001-catalogue-generic-portal-projection.md` |

## Goal

Prove as much of M11 as possible **without inventing** Income Certificate statutory policy:
config-only Studio authoring shell + catalogue-generic portal projection + explicit owner blockers.

## Delivered

1. **Income authoring shell** `templates/income-certificate/` — SAMPLE_LAB DUMMY policy YAML;
   form schema aligned to registry core fields in the catalogue stub.
2. **Stub catalogue** points `authoring_path` at that shell; maturity remains `SAMPLE_LAB_STUB`
   (DRAFT; not statutory PUBLISHED).
3. **Owner blocker inventory** `fixtures/m11/ind-soc-031/POLICY_INPUT_REQUIRED.md` (+ SF-61 dry-run fixtures).
4. **CCR-M11-001** — citizen/officer portals no longer hard-code IND-SOC-002 for projection /
   empty CTA / queue copy; `isOffered` also refuses `POLICY_INPUT_REQUIRED` policy.
5. **SAMPLE_LAB lab-offer** — placement may offer the DRAFT form with DUMMY params (fail-closed outside SAMPLE_LAB).
6. **Tests** — unit (catalogue resolve, Income lab-offer, dry-run fixtures) + e2e (`tests/e2e/m11-second-service-reuse.spec.ts`).

## Not delivered (owner / G3)

- Statutory PUBLISH of Income TSB + non-DUMMY citizen placement (**SF-33**).
- Second-service apply → Temporal → officer → SIM DigiLocker E2E as **G3 exit** proof.
- Module G3 exit · CERTIFIED · G6.

## Honesty

No Odisha or other State Income eligibility, fee, SLA, or DigiLocker registration was invented.
DigiLocker remains SIMULATED. Agents do not self-certify. Lab-offer ≠ PUBLISHED statutory offer.
