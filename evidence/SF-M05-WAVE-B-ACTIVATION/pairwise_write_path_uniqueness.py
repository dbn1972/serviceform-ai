#!/usr/bin/env python3
"""Prove Wave B 005||006||007||008 write-path uniqueness without changing the CG-01 gate.

Does not patch cg01_path_uniqueness_gate.py. Pairwise product/migration/evidence/handover
overlap among Wave B must be 0. Forbidden writers among Wave B must be 0.
Shared writable pnpm-lock.yaml / contracts/** / apps/** among Wave B must be false.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "gates"))
import cg01_path_uniqueness_gate as g  # noqa: E402

from _common import load_yaml  # noqa: E402

WAVE_B = ("SF-M05-005", "SF-M05-006", "SF-M05-007", "SF-M05-008")
HELD = (
    "SF-M05-STITCH-B",
    "SF-M05-009",
    "SF-M05-INT",
    "SF-M05-SEC",
    "SF-M05-EVD",
)
ORIGINAL_13 = [
    "SF-CON-AUDIT-EVENT",
    "SF-CON-AUTHZ-DECISION",
    "SF-CON-COMMON",
    "SF-CON-CONNECTOR-BINDING",
    "SF-CON-ERROR-RESPONSE",
    "SF-CON-EVENT-ENVELOPE",
    "SF-CON-IDEMPOTENCY",
    "SF-CON-ISOLATION-DECLARATION",
    "SF-CON-REQUEST-CONTEXT",
    "SF-CON-SIMULATION-MARKER",
    "SF-CON-ERROR-CATALOGUE",
    "SF-CON-DB-SESSION-CONTEXT",
    "SF-CON-OUTBOX",
]
M05_SIX = [
    "SF-CON-APPLICATION-CASE-SM",
    "SF-CON-WORKFLOW-MODEL",
    "SF-CON-COMMAND-TRANSITION",
    "SF-CON-HUMAN-TASK",
    "SF-CON-SLA-CLOCK",
    "SF-CON-VERSION-PINNING",
]
EXPECTED_19 = ORIGINAL_13 + M05_SIX
GATE_REL = "scripts/gates/cg01_path_uniqueness_gate.py"
LOCK_REL = "orchestrator/contracts-lock.yaml"
READY_PARENT = "905afad22b2112182ff17095272c7c34de4726a9"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_show(rev_path: str) -> bytes:
    return subprocess.check_output(["git", "show", rev_path], cwd=ROOT)


def load_env(kind: str, tid: str) -> dict:
    path = ROOT / "orchestrator" / kind / f"{tid}.yaml"
    data = load_yaml(path) or {}
    if not isinstance(data, dict):
        raise SystemExit(f"{path}: expected mapping")
    return data


def classify(path: str) -> str:
    p = path.replace("\\", "/")
    if p.startswith("services/"):
        return "product"
    if p.startswith("db/migrations/"):
        return "migration"
    if p.startswith("evidence/"):
        return "evidence"
    if p.startswith("orchestrator/handovers/"):
        return "handover"
    if p == "pnpm-lock.yaml" or p.endswith("/pnpm-lock.yaml"):
        return "lockfile"
    if p == "contracts" or p.startswith("contracts/") or p.startswith("contracts"):
        return "contracts"
    if p.startswith("apps/"):
        return "apps"
    return "other"


def main() -> int:
    errors: list[str] = []
    notes: list[str] = []
    out_dir = Path(__file__).resolve().parent
    logs = out_dir / "logs"
    logs.mkdir(parents=True, exist_ok=True)

    gate_now = (ROOT / GATE_REL).read_bytes()
    gate_main = git_show(f"origin/main:{GATE_REL}")
    if gate_now != gate_main:
        errors.append("cg01_path_uniqueness_gate.py differs from origin/main (must not weaken)")
    notes.append(f"gate_sha256={sha256_bytes(gate_now)}")
    notes.append("gate_bytes_unchanged_vs_origin_main=" + str(gate_now == gate_main))

    lock_now = (ROOT / LOCK_REL).read_bytes()
    lock_main = git_show(f"origin/main:{LOCK_REL}")
    if lock_now != lock_main:
        errors.append("orchestrator/contracts-lock.yaml mutated (forbidden in this slice)")

    overlap_hits: list[dict] = []
    forbidden: list[dict] = []
    pairs: list[dict] = []
    lock_counts: dict[str, int] = {}
    ready_flags: dict[str, dict] = {}
    class_overlaps = {"product": 0, "migration": 0, "evidence": 0, "handover": 0}
    shared_writable = {"lockfile": False, "contracts": False, "apps": False}

    envelopes: dict[str, dict] = {}
    byte_parity: dict[str, bool] = {}
    for tid in WAVE_B:
        task_path = ROOT / "orchestrator" / "tasks" / f"{tid}.yaml"
        hand_path = ROOT / "orchestrator" / "handovers" / f"{tid}.yaml"
        same = task_path.read_bytes() == hand_path.read_bytes()
        byte_parity[tid] = same
        if not same:
            errors.append(f"{tid}: tasks/handovers files are not byte-identical")
        task = load_env("tasks", tid)
        hand = load_env("handovers", tid)
        if task != hand:
            errors.append(f"{tid}: tasks YAML mapping diverges from handovers")
        envelopes[tid] = hand
        writes = [str(p) for p in (hand.get("allowed_write_paths") or [])]
        for p in writes:
            cls = classify(p)
            if g.is_forbidden_write(p):
                forbidden.append({"task_id": tid, "path": p})
                errors.append(f"{tid}: forbidden write path {p}")
            if cls in ("lockfile", "contracts", "apps"):
                shared_writable[cls] = True
                errors.append(f"{tid}: shared writable {cls} path {p}")
        locks = [str(x) for x in (hand.get("contract_locks") or [])]
        lock_counts[tid] = len(locks)
        if locks != EXPECTED_19:
            errors.append(f"{tid}: contract_locks must be original 13 + six M05 IDs in lock order (got {len(locks)})")
        parent = (hand.get("ready_record_parent") or {}).get("sha")
        if parent != READY_PARENT:
            errors.append(f"{tid}: ready_record_parent.sha must be {READY_PARENT}")
        policy = hand.get("dispatch_base_policy") or {}
        if policy.get("source") != "HUMAN_WAVE_B_DISPATCH_AUTHORIZATION":
            errors.append(f"{tid}: dispatch_base_policy.source mismatch")
        if policy.get("require_exact_sha") is not True:
            errors.append(f"{tid}: dispatch_base_policy.require_exact_sha must be true")
        if policy.get("must_include_wave_b_ready_record") is not True:
            errors.append(f"{tid}: dispatch_base_policy.must_include_wave_b_ready_record must be true")
        if policy.get("dispatch_base") is not None:
            errors.append(f"{tid}: dispatch_base must be null")
        if policy.get("dispatch_authorized") is not False:
            errors.append(f"{tid}: dispatch_authorized must be false")
        bc = hand.get("base_commit") or {}
        if bc.get("prefix") != "905afad2" or bc.get("suffix") != "2b2112182ff17095272c7c34de4726a9":
            errors.append(f"{tid}: base_commit must be activation provenance 905afad2 + remainder")
        flags = {
            "state": hand.get("state"),
            "orchestration_task_state": hand.get("orchestration_task_state"),
            "planning_only": hand.get("planning_only"),
            "implementation_authorized": hand.get("implementation_authorized"),
            "wave_eligible_now": hand.get("wave_eligible_now"),
            "dispatched": hand.get("dispatched"),
            "builders_dispatched_this_envelope": hand.get("builders_dispatched_this_envelope"),
            "certified": hand.get("certified"),
            "not_certified": hand.get("not_certified"),
            "self_certified": hand.get("self_certified"),
            "release_certified": hand.get("release_certified"),
            "g4": hand.get("g4"),
            "g6": hand.get("g6"),
            "ccr_required": hand.get("ccr_required"),
            "frozen_contracts_altered": hand.get("frozen_contracts_altered"),
            "dispatch_authorized": policy.get("dispatch_authorized"),
            "dispatch_base": policy.get("dispatch_base"),
        }
        ready_flags[tid] = flags
        if flags["state"] != "READY" or flags["orchestration_task_state"] != "READY":
            errors.append(f"{tid}: state/orchestration_task_state must be READY")
        if flags["planning_only"] is not False:
            errors.append(f"{tid}: planning_only must be false")
        if flags["implementation_authorized"] is not True:
            errors.append(f"{tid}: implementation_authorized must be true")
        if flags["wave_eligible_now"] is not True:
            errors.append(f"{tid}: wave_eligible_now must be true")
        if flags["dispatched"] is not False:
            errors.append(f"{tid}: dispatched must be false")
        if flags["builders_dispatched_this_envelope"] is not False:
            errors.append(f"{tid}: builders_dispatched_this_envelope must be false")
        if flags["certified"] or flags["g4"] or flags["g6"] or flags["self_certified"] or flags["release_certified"]:
            errors.append(f"{tid}: must not claim certified/g4/g6/self_certified/release_certified")
        if flags["not_certified"] is not True:
            errors.append(f"{tid}: not_certified must be true")
        if flags["ccr_required"] is not False:
            errors.append(f"{tid}: ccr_required must be false")
        if flags["frozen_contracts_altered"] is not False:
            errors.append(f"{tid}: frozen_contracts_altered must be false")

    for i, a_id in enumerate(WAVE_B):
        for b_id in WAVE_B[i + 1 :]:
            hits = g.overlapping_paths(envelopes[a_id], envelopes[b_id])
            classed = []
            for a, b in hits:
                cls_a, cls_b = classify(a), classify(b)
                cls = cls_a if cls_a == cls_b else "mixed"
                if cls in class_overlaps:
                    class_overlaps[cls] += 1
                classed.append({"left": a, "right": b, "class": cls})
                overlap_hits.append({"left": a_id, "path_left": a, "right": b_id, "path_right": b, "class": cls})
                errors.append(f"write-path overlap {a_id} `{a}` ∩ {b_id} `{b}`")
            pairs.append({"left": a_id, "right": b_id, "overlaps": len(hits), "hits": classed})

    held_flags: dict[str, dict] = {}
    for tid in HELD:
        env = load_env("handovers", tid)
        held_flags[tid] = {
            "state": env.get("state"),
            "planning_only": env.get("planning_only"),
            "implementation_authorized": env.get("implementation_authorized"),
            "wave_eligible_now": env.get("wave_eligible_now"),
            "dispatched": env.get("dispatched"),
        }
        if env.get("state") != "PLANNING":
            errors.append(f"{tid}: must remain PLANNING")
        if env.get("planning_only") is not True:
            errors.append(f"{tid}: planning_only must remain true")
        if env.get("implementation_authorized") is not False:
            errors.append(f"{tid}: implementation_authorized must remain false")
        if env.get("wave_eligible_now") is not False:
            errors.append(f"{tid}: wave_eligible_now must remain false")
        if env.get("dispatched") is True:
            errors.append(f"{tid}: dispatched must remain false")

    cg = load_env("handovers", "SF-M05-CG-001")
    decision = cg.get("decision") or {}
    if decision.get("family") != "SF_M05_CG001_FREEZE" or decision.get("status") != "FROZEN_ON_MAIN":
        errors.append("CG-001 decision family/status must be split FROZEN_ON_MAIN")
    if cg.get("repository_freeze_effective") is not True:
        errors.append("CG-001 repository_freeze_effective must be true")
    if (cg.get("existing_frozen") or {}).get("result") != "MATCH":
        errors.append("CG-001 original 13 must remain MATCH")
    if (cg.get("lock_expected") or {}).get("frozen") != 19:
        errors.append("CG-001 lock_expected.frozen must be 19")
    if len(cg.get("contract_locks") or []) != 19:
        errors.append("CG-001 contract_locks must be 19")
    if cg.get("ccr_required") is not False:
        errors.append("CG-001 ccr_required must be false")

    gate = subprocess.run(
        [sys.executable, str(ROOT / GATE_REL)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    (logs / "cg01_path_uniqueness_gate.log").write_text(gate.stdout + gate.stderr, encoding="utf-8")
    if gate.returncode != 0:
        errors.append(f"cg01_path_uniqueness_gate.py exit {gate.returncode}")

    if any(class_overlaps.values()):
        errors.append(f"classified overlaps must be 0: {class_overlaps}")
    if any(shared_writable.values()):
        errors.append(f"shared writable lockfile/contracts/apps must be false: {shared_writable}")

    summary = {
        "slice": "SF-M05-WAVE-B-ACTIVATION",
        "parallel_set": list(WAVE_B),
        "ready_record_parent": READY_PARENT,
        "pairwise_overlaps": len(overlap_hits),
        "classified_overlaps": class_overlaps,
        "shared_writable_lockfile_contracts_apps": shared_writable,
        "forbidden_writers": len(forbidden),
        "task_handover_byte_identical": byte_parity,
        "pairs": pairs,
        "overlap_hits": overlap_hits,
        "forbidden": forbidden,
        "contract_locks_count": lock_counts,
        "ready_flags": ready_flags,
        "held_off": held_flags,
        "cg001": {
            "state": cg.get("state"),
            "repository_freeze_effective": cg.get("repository_freeze_effective"),
            "existing_frozen": cg.get("existing_frozen"),
            "lock_expected": cg.get("lock_expected"),
            "contract_locks_count": len(cg.get("contract_locks") or []),
            "ccr_required": cg.get("ccr_required"),
        },
        "gate_script": GATE_REL,
        "gate_unchanged_vs_origin_main": gate_now == gate_main,
        "gate_sha256": sha256_bytes(gate_now),
        "contracts_lock_unchanged_vs_origin_main": lock_now == lock_main,
        "cg01_path_uniqueness_gate_exit": gate.returncode,
        "builders_spawned": "NONE",
        "dispatch_authorized": False,
        "dispatch_base": None,
        "stitch_b": "OFF",
        "errors": errors,
        "notes": notes,
        "result": "PASS" if not errors else "FAIL",
    }
    (out_dir / "uniqueness.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    (logs / "uniqueness.log").write_text(
        f"pairwise_overlaps={len(overlap_hits)}\nforbidden_writers={len(forbidden)}\nresult={summary['result']}\n"
        + ("\n".join(errors) + "\n" if errors else ""),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "result": summary["result"],
                "overlaps": len(overlap_hits),
                "forbidden": len(forbidden),
                "classified": class_overlaps,
                "shared_writable": shared_writable,
            },
            indent=2,
        )
    )
    if errors:
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
