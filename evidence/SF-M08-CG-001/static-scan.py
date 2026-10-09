#!/usr/bin/env python3
"""Static scans on the CG-02 freeze-prep write set (not a secret scanner)."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
scan_roots = [
    ROOT / "contracts/m06",
    ROOT / "contracts/m08",
    ROOT / "orchestrator/handovers/SF-M06-CG-001.yaml",
    ROOT / "orchestrator/handovers/SF-M08-CG-001.yaml",
    ROOT / "orchestrator/contracts-lock.yaml",
]
files: list[Path] = []
for p in scan_roots:
    if p.is_file():
        files.append(p)
    elif p.is_dir():
        files.extend([f for f in p.rglob("*") if f.is_file()])

fail = 0
lines = []


def log(s: str) -> None:
    lines.append(s)
    print(s)


for schema_dir in [ROOT / "contracts/m06/schemas", ROOT / "contracts/m08/schemas"]:
    for f in schema_dir.glob("*.schema.json"):
        text = f.read_text(encoding="utf-8")
        if '"const": "PROPOSED"' in text:
            fail += 1
            log(f"FAIL {f.name} still PROPOSED")
        if '"const": "FROZEN"' not in text:
            fail += 1
            log(f"FAIL {f.name} missing FROZEN const")
        for tok in ["officer_name", "named_officer", "employee_name"]:
            if tok in text:
                fail += 1
                log(f"FAIL {f.name} contains {tok}")

ret = (ROOT / "contracts/m08/schemas/retention-policy.schema.json").read_text()
if '"retention_days"' in ret or '"period_days"' in ret:
    fail += 1
    log("FAIL retention-policy invents day-count fields")
else:
    log("PASS retention-policy policy-neutral")
if "statutory_retention_policy_input_required" not in ret:
    fail += 1
    log("FAIL retention missing statutory flag")
else:
    log("PASS retention statutory flag present")

rec = (ROOT / "contracts/m08/schemas/recommendation.schema.json").read_text()
if '"authoritative"' not in rec or '"const": false' not in rec:
    fail += 1
    log("FAIL recommendation missing authoritative=false")
else:
    log("PASS recommendation authoritative=false")

for ht_path in [
    ROOT / "orchestrator/handovers/SF-M06-CG-001.yaml",
    ROOT / "orchestrator/handovers/SF-M08-CG-001.yaml",
]:
    ht = ht_path.read_text()
    checks = [
        (r"^freeze_authorized:\s*true\s*$", "freeze_authorized true"),
        (r"^freeze_prepared:\s*true\s*$", "freeze_prepared true"),
        (r"^repository_freeze_effective:\s*false\s*$", "repository_freeze_effective false"),
        (r"^implementation_authorized:\s*false\s*$", "implementation_authorized false"),
        (r"^dispatched:\s*false\s*$", "dispatched false"),
        (r"^wave_a_eligible:\s*false\s*$", "wave_a_eligible false"),
        (r"^contracts_status:\s*FROZEN_CANDIDATE\s*$", "contracts_status FROZEN_CANDIDATE"),
        (r"^freeze_status:\s*PENDING_MERGE\s*$", "freeze_status PENDING_MERGE"),
        (r"^orchestration_task_state:\s*FREEZE_PREPARED\s*$", "orchestration_task_state FREEZE_PREPARED"),
        (r"^state:\s*FREEZE_PREPARED\s*$", "state FREEZE_PREPARED"),
        (r"^builders_dispatched_this_envelope:\s*false\s*$", "builders false"),
        (r"^certified:\s*false\s*$", "certified false"),
        (r"^g6:\s*false\s*$", "g6 false"),
        (r"^ccr_required:\s*false\s*$", "ccr_required false"),
    ]
    for pat, name in checks:
        if not re.search(pat, ht, re.M):
            fail += 1
            log(f"FAIL {ht_path.name} missing {name}")
        else:
            log(f"PASS {ht_path.name} {name}")

# Forbidden promotion tokens — split so this scanner file is not self-bait
joined = "\n".join(f.read_text(encoding="utf-8", errors="ignore") for f in files)
bait = [
    "M05" + "_PLANNING_READY",
    "READY" + "_PROMOTED",
    "builders_dispatched_this_envelope: " + "true",
]
for bad in bait:
    if bad in joined:
        fail += 1
        log(f"FAIL write set contains {bad}")

log(f"static-scan failures={fail}")
for rel in ["evidence/SF-M06-CG-001/logs", "evidence/SF-M08-CG-001/logs"]:
    d = ROOT / rel
    d.mkdir(parents=True, exist_ok=True)
    (d / "static-scan.log").write_text("\n".join(lines) + "\n")
sys.exit(1 if fail else 0)
