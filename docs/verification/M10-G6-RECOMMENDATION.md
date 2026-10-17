# M10 G6 recommendation — POLICY sample resolved · G6 **not issuable yet**

**Disposition: `SF_M10_EVD_PASS_POLICY_RESOLVED_G6_HOLD`**

Independent evidence note after human authorization to use a **public state reference** (Odisha e-District Resident Certificate, https://edistrict.odisha.gov.in/) as sample owner input for IND-SOC-002.

This record does **not** issue G6, CERTIFIED, or RELEASE CERTIFIED. `recording_agent_self_issued=false`.

| Field | Value |
|---|---|
| Module | M10 Golden Residence Certificate (IND-SOC-002) |
| Sample state | Odisha (`IN-OD`) |
| Public portal | https://edistrict.odisha.gov.in/ |
| Policy inventory | Resolved in `fixtures/golden/ind-soc-002/` (see `SOURCE_PROVENANCE.md`) |
| Local INT (owner ready) | **24 passed · 6 todo** (`SF_M10_OWNER_INPUTS_READY=1`; includes G6 connector holds) |
| Recommended result | **Hold G6 issuance** — policy sample unblocks metadata golden path; production G6 still blocked |
| `G6_ISSUED` / `gate_issued` | **false** |
| CERTIFIED / self_certified | **false** |

## What was resolved from the public portal

| Input | Odisha portal fact |
|---|---|
| Eligibility | ≥1 year continuous residence in concerned Tahasil (+ published relaxations) |
| Fee | No Government Service charge (₹0) |
| SLA | 10 working days |
| Evidence list | Published any-one/more document list |
| Department / authority class | Revenue & Disaster Management / Tahasildar |

DigiLocker doc type and DLT PE-IDs remain **`SAMPLE_LAB_*`** (not published on the portal).

## Holds blocking human G6 issuance

See inventory: [`M10-G6-PREREQUISITES.md`](./M10-G6-PREREQUISITES.md).

1. **G5 performance / soak** evidence not on tip (`SF-M10-004` / `SF-M10-PERF` PLANNING)  
2. **Resilience / backup-restore / rollback** evidence not on tip  
3. **REAL DigiLocker** critical-connector validation (SAMPLE_LAB only; payment ₹0 skip OK for lab)  
4. **UX4G** visual/a11y evidence for golden citizen path not bound (`SF-M10-005` PLANNING)  
5. Studio **immutability seal** of published TSB deferred until REAL DigiLocker/DLT bindings exist  

## Certification stance

CERTIFIED=false · G6=false · g6_recommended_for_issuance=false · g6_issued=false · policy_sample_resolved=true · self_certified=false  

When holds 1–5 clear, EVD may re-bind and recommend `G6_RELEASE_CERTIFIED`; only a human may issue.
