#!/usr/bin/env python3
"""Static scans on the pre-freeze write set (not a secret scanner)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
paths = [
    ROOT / "docs/adr/ADR-0003-withdrawal-cancellation-request-states.md",
    ROOT / "docs/adr/ADR-0005-authorization-policy-version-for-in-flight-cases.md",
    ROOT / "docs/adr/README.md",
    ROOT / "contracts/m05",
    ROOT / "evidence/SF-M05-CG-001",
    ROOT / "orchestrator/handovers/SF-M05-CG-001.yaml",
]
files: list[Path] = []
for p in paths:
    if p.is_file():
        files.append(p)
    elif p.is_dir():
        files.extend([f for f in p.rglob("*") if f.is_file()])

joined_tokens = [
    "M05_PLANNING_READY",  # must stay split in handover
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
    if "FROZEN" in text and "NOT_FROZEN" not in text:
        fail += 1
        log(f"FAIL {f.name} claims FROZEN without NOT_FROZEN")

# M05 schemas must not treat Temporal as the case authority
for f in schema_dir.glob("*.schema.json"):
    text = f.read_text(encoding="utf-8")
    if "authoritative application/case" in text.lower() and "CMP-016" in text:
        fail += 1
        log(f"FAIL {f.name} appears to give case authority to workflow")

import re

handover = ROOT / "orchestrator/handovers/SF-M05-CG-001.yaml"
ht = handover.read_text(encoding="utf-8") if handover.is_file() else ""
if re.search(r"^freeze_authorized:\s*true\s*$", ht, re.M):
    fail += 1
    log("FAIL handover freeze_authorized true")
if re.search(r"^implementation_authorized:\s*true\s*$", ht, re.M):
    fail += 1
    log("FAIL handover implementation_authorized true")
if re.search(r"^wave_a_eligible:\s*true\s*$", ht, re.M):
    fail += 1
    log("FAIL handover wave_a_eligible true")
if not re.search(r"^adr_0003_status:\s*ACCEPTED\s*$", ht, re.M):
    fail += 1
    log("FAIL handover adr_0003_status must be ACCEPTED")
if not re.search(r"^adr_0005_status:\s*ACCEPTED\s*$", ht, re.M):
    fail += 1
    log("FAIL handover adr_0005_status must be ACCEPTED")
if re.search(r"^freeze_status:\s*FROZEN\s*$", ht, re.M):
    fail += 1
    log("FAIL handover freeze_status FROZEN")

import json

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
