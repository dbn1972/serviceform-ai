#!/usr/bin/env python3
"""Control-plane consistency for M05 Wave B READY activation (005-008 only)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "gates"))
from _common import load_yaml  # noqa: E402

WAVE_B = ("SF-M05-005", "SF-M05-006", "SF-M05-007", "SF-M05-008")
HELD = (
    "SF-M05-STITCH-B",
    "SF-M05-009",
    "SF-M05-INT",
    "SF-M05-SEC",
    "SF-M05-EVD",
)
KEYS = (
    "state",
    "orchestration_task_state",
    "planning_only",
    "implementation_authorized",
    "dispatched",
    "wave_eligible_now",
    "builders_dispatched_this_envelope",
    "allowed_write_paths",
    "contract_locks",
    "serial_after",
    "ccr_required",
    "g4",
    "g6",
    "certified",
    "not_certified",
    "self_certified",
    "release_certified",
    "frozen_contracts_altered",
    "dispatch_base_policy",
    "ready_record_parent",
)


def load(kind: str, tid: str) -> dict:
    return load_yaml(ROOT / "orchestrator" / kind / f"{tid}.yaml") or {}


def main() -> int:
    errors: list[str] = []
    rows: dict[str, dict] = {}
    for tid in WAVE_B:
        task_bytes = (ROOT / "orchestrator" / "tasks" / f"{tid}.yaml").read_bytes()
        hand_bytes = (ROOT / "orchestrator" / "handovers" / f"{tid}.yaml").read_bytes()
        task = load("tasks", tid)
        hand = load("handovers", tid)
        row = {
            "task_keys": {},
            "handover_keys": {},
            "match": True,
            "byte_identical": task_bytes == hand_bytes,
        }
        if task_bytes != hand_bytes:
            row["match"] = False
            errors.append(f"{tid}: task/handover files not byte-identical")
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
        policy = hand.get("dispatch_base_policy") or {}
        if policy.get("dispatch_authorized") is not False:
            errors.append(f"{tid}: dispatch_authorized must be false")
        if policy.get("dispatch_base") is not None:
            errors.append(f"{tid}: dispatch_base must be null")
        rows[tid] = row

    held = {}
    for tid in HELD:
        env = load("handovers", tid)
        held[tid] = {
            "state": env.get("state"),
            "planning_only": env.get("planning_only"),
            "implementation_authorized": env.get("implementation_authorized"),
            "dispatched": env.get("dispatched"),
            "wave_eligible_now": env.get("wave_eligible_now"),
        }
        if env.get("state") != "PLANNING" or env.get("implementation_authorized") is not False:
            errors.append(f"{tid}: must remain OFF/PLANNING")

    out = Path(__file__).resolve().parent / "control-plane-consistency.json"
    payload = {
        "result": "PASS" if not errors else "FAIL",
        "errors": errors,
        "envelopes": rows,
        "held_off": held,
        "builders_spawned": "NONE",
        "stitch_b": "OFF",
        "g4": False,
        "certified": False,
        "g6": False,
    }
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"result": payload["result"], "errors": len(errors)}))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
