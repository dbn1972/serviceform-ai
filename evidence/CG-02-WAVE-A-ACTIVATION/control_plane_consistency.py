#!/usr/bin/env python3
"""Control-plane consistency for CG-02 Wave A READY activation (seven lanes)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "gates"))
from _common import load_yaml  # noqa: E402

WAVE_A = (
    "SF-M06-001",
    "SF-M06-002",
    "SF-M06-003",
    "SF-M08-001",
    "SF-M08-002",
    "SF-M08-003",
    "SF-M08-004",
)
KEYS = (
    "state",
    "planning_only",
    "implementation_authorized",
    "dispatched",
    "wave_eligible_now",
    "allowed_write_paths",
    "contract_locks",
    "serial_after",
    "ccr_required",
    "builders_dispatched_this_envelope",
)


def load(kind: str, tid: str) -> dict:
    return load_yaml(ROOT / "orchestrator" / kind / f"{tid}.yaml") or {}


def main() -> int:
    errors: list[str] = []
    rows: dict[str, dict] = {}
    for tid in WAVE_A:
        task = load("tasks", tid)
        hand = load("handovers", tid)
        row = {"task_keys": {}, "handover_keys": {}, "match": True}
        for key in KEYS:
            row["task_keys"][key] = task.get(key)
            row["handover_keys"][key] = hand.get(key)
            if task.get(key) != hand.get(key):
                row["match"] = False
                errors.append(f"{tid}: {key} task/handover mismatch")
        tbc, hbc = task.get("base_commit") or {}, hand.get("base_commit") or {}
        if tbc.get("prefix") != hbc.get("prefix") or tbc.get("suffix") != hbc.get("suffix"):
            row["match"] = False
            errors.append(f"{tid}: base_commit task/handover mismatch")
        if len(task.get("contract_locks") or []) != 24:
            errors.append(f"{tid}: tasks contract_locks count {len(task.get('contract_locks') or [])}")
        if len(hand.get("contract_locks") or []) != 24:
            errors.append(f"{tid}: handovers contract_locks count {len(hand.get('contract_locks') or [])}")
        rows[tid] = row

    held = load("handovers", "SF-M08-005")
    if held.get("state") != "PLANNING" or held.get("planning_only") is not True:
        errors.append("SF-M08-005 must remain PLANNING / planning_only")
    if held.get("implementation_authorized") is not False or held.get("wave_eligible_now") is True:
        errors.append("SF-M08-005 must not be implementation_authorized or wave_eligible_now")

    for cg_id in ("SF-M06-CG-001", "SF-M08-CG-001"):
        cg = load("handovers", cg_id)
        if cg.get("state") != "FROZEN_ON_MAIN":
            errors.append(f"{cg_id}: state must be FROZEN_ON_MAIN")
        if cg.get("repository_freeze_effective") is not True:
            errors.append(f"{cg_id}: repository_freeze_effective must be true")
        if list(cg.get("wave_a_eligible_now") or []) != list(WAVE_A):
            errors.append(f"{cg_id}: wave_a_eligible_now must be the seven READY lanes")

    out = Path(__file__).resolve().parent / "control-plane-consistency.json"
    payload = {"result": "PASS" if not errors else "FAIL", "errors": errors, "envelopes": rows}
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"result": payload["result"], "errors": len(errors)}))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
