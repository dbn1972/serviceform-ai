#!/usr/bin/env python3
"""Control-plane consistency for M05 Wave A READY activation (001-004 only)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "gates"))
from _common import load_yaml  # noqa: E402

WAVE_A = ("SF-M05-001", "SF-M05-002", "SF-M05-003", "SF-M05-004")
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
        if len(task.get("contract_locks") or []) != 19:
            errors.append(f"{tid}: tasks contract_locks count {len(task.get('contract_locks') or [])}")
        if len(hand.get("contract_locks") or []) != 19:
            errors.append(f"{tid}: handovers contract_locks count {len(hand.get('contract_locks') or [])}")
        rows[tid] = row
    out = Path(__file__).resolve().parent / "control-plane-consistency.json"
    payload = {"result": "PASS" if not errors else "FAIL", "errors": errors, "envelopes": rows}
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"result": payload["result"], "errors": len(errors)}))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
