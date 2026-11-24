# IND-SOC-031 dry-run checklist (SAMPLE_LAB)

Use this when walking the M11 second-service config-reuse path. Tick only what was executed.

- [ ] Open Studio template `ind-soc-031.income-certificate` — DRAFT / SAMPLE_LAB_STUB visible
- [ ] Open Forms designer from catalogue row IND-SOC-031
- [ ] Open Fee designer starter `ind-soc-031-dummy` — amount labeled SAMPLE_LAB DUMMY
- [ ] Open SLA designer starter `ind-soc-031-sla` — P15D lab ISO, not statute
- [ ] Open Evidence designer starter `ind-soc-031-evidence` — SAMPLE_LAB_DUMMY_EVIDENCE_ANY
- [ ] Open Credential designer starter `ind-soc-031-credential` — SAMPLE_LAB DigiLocker label · SIMULATED
- [ ] Confirm `fixtures/m11/ind-soc-031/tsb-dry-run-fixture.json` pin graph refs authoring shell
- [ ] Confirm citizen catalogue lab-offers Income only under `environment_label=SAMPLE_LAB`
- [ ] Confirm version status remains **DRAFT** (no PUBLISHED statutory offer)
- [ ] Confirm SF-33 owner blockers still listed in `POLICY_INPUT_REQUIRED.md` + `SF33_PUBLISH_BLOCKER.md`
- [ ] Confirm `sf33-publish-gate.json` has `statutory_publish=BLOCKED` and `publish_blocker=SF-33`
- [ ] Confirm `PLATFORM_REUSE_GAP_LIST.md` lists no new `services/**` Income backend
- [ ] Record run tip SHA in `evidence/SF-P8-GOLDEN2/` — do **not** claim CERTIFIED / G6

**Fail if:** any Act citation invented, REAL DigiLocker/SMS/Payment wired, or Income marked PUBLISHED without owner SF-33 inputs.

**P8-6 re-run:** `scripts/dev/p8-golden2-evidence.sh` (requires `platform-lab.sh up`).
