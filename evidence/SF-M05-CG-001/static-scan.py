#!/usr/bin/env python3
"""Static scans on the freeze-prep write set (not a secret scanner)."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
paths = [
    ROOT / "contracts/m05",
    ROOT / "evidence/SF-M05-CG-001",
    ROOT / "orchestrator/handovers/SF-M05-CG-001.yaml",
    ROOT / "orchestrator/contracts-lock.yaml",
]
files: list[Path] = []
for p in paths:
    if p.is_file():
        files.append(p)
    elif p.is_dir():
        files.extend([f for f in p.rglob("*") if f.is_file()])

joined_tokens = [
    "M05_PLANNING_READY",
    "SF_M05_CG001_FREEZE_PREPARED",
]
schema_forbidden_in_schemas = [
    "officer_name",
    "named_officer",
    "employee_name",
    "BPMN_ENGINE",
]

fail = 0
lines = []


def log(s: str) -> None:
    lines.append(s)
    print(s)


schema_dir = ROOT / "contracts/m05/schemas"
for f in schema_dir.glob("*.schema.json"):
    text = f.read_text(encoding="utf-8")
    for tok in schema_forbidden_in_schemas:
        if tok in text:
            fail += 1
            log(f"FAIL {f.name} contains {tok}")
    if '"const": "PROPOSED"' in text:
        fail += 1
        log(f"FAIL {f.name} still PROPOSED")
    if '"const": "NOT_FROZEN"' in text:
        fail += 1
        log(f"FAIL {f.name} still NOT_FROZEN")
    if '"const": "FROZEN"' not in text:
        fail += 1
        log(f"FAIL {f.name} missing FROZEN const")

for f in schema_dir.glob("*.schema.json"):
    text = f.read_text(encoding="utf-8")
    if "authoritative application/case" in text.lower() and "CMP-016" in text:
        fail += 1
        log(f"FAIL {f.name} appears to give case authority to workflow")

handover = ROOT / "orchestrator/handovers/SF-M05-CG-001.yaml"
ht = handover.read_text(encoding="utf-8") if handover.is_file() else ""
for tok in joined_tokens:
    if tok in ht:
        fail += 1
        log(f"FAIL handover contains joined scanner-bait token {tok}")
if not re.search(r"^freeze_authorized:\s*true\s*$", ht, re.M):
    fail += 1
    log("FAIL handover freeze_authorized must be true")
if not re.search(r"^freeze_prepared:\s*true\s*$", ht, re.M):
    fail += 1
    log("FAIL handover freeze_prepared must be true")
if not re.search(r"^repository_freeze_effective:\s*false\s*$", ht, re.M):
    fail += 1
    log("FAIL handover repository_freeze_effective must be false")
if re.search(r"^implementation_authorized:\s*true\s*$", ht, re.M):
    fail += 1
    log("FAIL handover implementation_authorized true")
if re.search(r"^wave_a_eligible:\s*true\s*$", ht, re.M):
    fail += 1
    log("FAIL handover wave_a_eligible true")
if re.search(r"^m05_started:\s*true\s*$", ht, re.M):
    fail += 1
    log("FAIL handover m05_started true")
if re.search(r"^m05_dispatched:\s*true\s*$", ht, re.M):
    fail += 1
    log("FAIL handover m05_dispatched true")
if not re.search(r"^adr_0003_status:\s*ACCEPTED\s*$", ht, re.M):
    fail += 1
    log("FAIL handover adr_0003_status must be ACCEPTED")
if not re.search(r"^adr_0005_status:\s*ACCEPTED\s*$", ht, re.M):
    fail += 1
    log("FAIL handover adr_0005_status must be ACCEPTED")
if not re.search(r"^freeze_status:\s*PENDING_MERGE\s*$", ht, re.M):
    fail += 1
    log("FAIL handover freeze_status must be PENDING_MERGE")
if not re.search(r"^contracts_status:\s*FROZEN_CANDIDATE\s*$", ht, re.M):
    fail += 1
    log("FAIL handover contracts_status must be FROZEN_CANDIDATE")
if not re.search(r"^state:\s*FREEZE_PREPARED\s*$", ht, re.M):
    fail += 1
    log("FAIL handover state must be FREEZE_PREPARED")
for claim in ("certified: true", "release_certified: true", "g6: true", "self_certified: true"):
    if re.search(rf"^{re.escape(claim)}$", ht, re.M):
        fail += 1
        log(f"FAIL handover {claim}")

sm = json.loads((ROOT / "contracts/m05/schemas/application-case-sm.schema.json").read_text())
always = sm["$defs"]["alwaysLegalTransitionKey"]["enum"]
gated_w = sm["$defs"]["policyGatedWithdrawalKey"]["enum"]
gated_c = sm["$defs"]["policyGatedCancellationKey"]["enum"]
bad_always = [k for k in always if k.endswith(">WITHDRAWN") or k.endswith(">CANCELLED")]
if bad_always:
    fail += 1
    log(f"FAIL alwaysLegalTransitionKey contains policy outcomes: {bad_always}")
missing_w = [k for k in gated_w if not k.endswith(">WITHDRAWN")]
missing_c = [k for k in gated_c if not k.endswith(">CANCELLED")]
if missing_w or missing_c:
    fail += 1
    log(f"FAIL policy-gated key sets mix non-outcome keys w={missing_w} c={missing_c}")
if not set(always).isdisjoint(set(gated_w) | set(gated_c)):
    fail += 1
    log("FAIL overlap between ALWAYS_LEGAL and policy-gated keys")

if fail == 0:
    log("PASS static scans")
(ROOT / "evidence/SF-M05-CG-001/logs/static-scan.log").write_text("\n".join(lines) + "\n")
sys.exit(1 if fail else 0)
