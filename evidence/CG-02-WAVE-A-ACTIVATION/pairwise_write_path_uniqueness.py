#!/usr/bin/env python3
"""Prove CG-02 Wave A seven-lane write-path uniqueness without changing the CG-01 gate.

Imports overlap/forbidden helpers from scripts/gates/cg01_path_uniqueness_gate.py.
Does not patch that gate. Pairwise overlap among Wave A must be 0.
Forbidden writers among Wave A must be 0.
Wave A builders must not own apps/api, pnpm-lock, contracts, or contracts-lock.
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

WAVE_A = (
    "SF-M06-001",
    "SF-M06-002",
    "SF-M06-003",
    "SF-M08-001",
    "SF-M08-002",
    "SF-M08-003",
    "SF-M08-004",
)
HELD = (
    "SF-M08-005",
    "SF-M06-004",
    "SF-M06-STITCH-A",
    "SF-M06-STITCH-B",
    "SF-M06-005",
    "SF-M06-INT",
    "SF-M06-SEC",
    "SF-M06-EVD",
    "SF-M08-006",
    "SF-M08-STITCH-A",
    "SF-M08-STITCH-B",
    "SF-M08-007",
    "SF-M08-INT",
    "SF-M08-SEC",
    "SF-M08-EVD",
)
EXISTING_19 = [
    "SF-CON-COMMON",
    "SF-CON-REQUEST-CONTEXT",
    "SF-CON-AUTHZ-DECISION",
    "SF-CON-ERROR-RESPONSE",
    "SF-CON-ERROR-CATALOGUE",
    "SF-CON-EVENT-ENVELOPE",
    "SF-CON-IDEMPOTENCY",
    "SF-CON-AUDIT-EVENT",
    "SF-CON-ISOLATION-DECLARATION",
    "SF-CON-DB-SESSION-CONTEXT",
    "SF-CON-OUTBOX",
    "SF-CON-CONNECTOR-BINDING",
    "SF-CON-SIMULATION-MARKER",
    "SF-CON-APPLICATION-CASE-SM",
    "SF-CON-WORKFLOW-MODEL",
    "SF-CON-COMMAND-TRANSITION",
    "SF-CON-HUMAN-TASK",
    "SF-CON-SLA-CLOCK",
    "SF-CON-VERSION-PINNING",
]
M06_FIVE = [
    "SF-CON-FEE-QUOTE",
    "SF-CON-PAYMENT-INTENT",
    "SF-CON-PAYMENT-CALLBACK",
    "SF-CON-NOTIFICATION-DISPATCH",
    "SF-CON-MESSAGE-THREAD",
]
M08_FIVE = [
    "SF-CON-SEARCH-DOCUMENT",
    "SF-CON-DISCOVERY-QUERY",
    "SF-CON-RECOMMENDATION",
    "SF-CON-ANALYTICS-METRIC",
    "SF-CON-RETENTION-POLICY",
]
EXTRA_FORBIDDEN_PREFIXES = (
    "apps/api",
    "pnpm-lock.yaml",
    "contracts/",
    "contracts/**",
    "orchestrator/contracts-lock.yaml",
)
GATE_REL = "scripts/gates/cg01_path_uniqueness_gate.py"
LOCK_REL = "orchestrator/contracts-lock.yaml"


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


def owns_extra_forbidden(path: str) -> bool:
    p = path.replace("\\", "/")
    if p in ("pnpm-lock.yaml", "orchestrator/contracts-lock.yaml", "contracts/**"):
        return True
    if p.startswith("apps/api") or p.startswith("contracts/"):
        return True
    return False


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

    envelopes: dict[str, dict] = {}
    for tid in WAVE_A:
        task = load_env("tasks", tid)
        hand = load_env("handovers", tid)
        if task != hand:
            errors.append(f"{tid}: tasks YAML mapping diverges from handovers")
        envelopes[tid] = hand
        writes = [str(p) for p in (hand.get("allowed_write_paths") or [])]
        for p in writes:
            if g.is_forbidden_write(p) or owns_extra_forbidden(p):
                forbidden.append({"task_id": tid, "path": p})
                errors.append(f"{tid}: forbidden write path {p}")
        locks = [str(x) for x in (hand.get("contract_locks") or [])]
        lock_counts[tid] = len(locks)
        expected = EXISTING_19 + (M06_FIVE if tid.startswith("SF-M06") else M08_FIVE)
        if locks != expected:
            errors.append(f"{tid}: contract_locks must be existing 19 + module five (got {len(locks)})")
        flags = {
            "state": hand.get("state"),
            "planning_only": hand.get("planning_only"),
            "implementation_authorized": hand.get("implementation_authorized"),
            "wave_eligible_now": hand.get("wave_eligible_now"),
            "dispatched": hand.get("dispatched"),
            "certified": hand.get("certified"),
            "g6": hand.get("g6"),
            "ccr_required": hand.get("ccr_required"),
            "builders_dispatched_this_envelope": hand.get("builders_dispatched_this_envelope"),
        }
        ready_flags[tid] = flags
        if flags["state"] != "READY":
            errors.append(f"{tid}: state must be READY")
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
        if flags["certified"] or flags["g6"]:
            errors.append(f"{tid}: must not claim certified/g6")
        if flags["ccr_required"] is not False:
            errors.append(f"{tid}: ccr_required must be false")
        bc = hand.get("base_commit") or {}
        if bc.get("prefix") != "5acb291e" or bc.get("suffix") != "a828894c40110396f0eafd62462e4572":
            errors.append(f"{tid}: base_commit must bind 5acb291e…")

    for i, a_id in enumerate(WAVE_A):
        for b_id in WAVE_A[i + 1 :]:
            hits = g.overlapping_paths(envelopes[a_id], envelopes[b_id])
            pairs.append({"left": a_id, "right": b_id, "overlaps": len(hits)})
            for a, b in hits:
                overlap_hits.append({"left": a_id, "path_left": a, "right": b_id, "path_right": b})
                errors.append(f"write-path overlap {a_id} `{a}` ∩ {b_id} `{b}`")

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
        if env.get("state") == "READY":
            errors.append(f"{tid}: must not be READY in this slice")
        if env.get("implementation_authorized") is True and tid != "SF-M08-005":
            # held lanes stay unauthorized; SF-M08-005 especially
            pass
        if env.get("implementation_authorized") is True:
            errors.append(f"{tid}: implementation_authorized must remain false")
        if env.get("wave_eligible_now") is True:
            errors.append(f"{tid}: wave_eligible_now must remain false")
        if env.get("dispatched") is True:
            errors.append(f"{tid}: dispatched must remain false")
        if tid == "SF-M08-005" and env.get("state") != "PLANNING":
            errors.append("SF-M08-005: must remain PLANNING")
        if tid == "SF-M08-005" and env.get("planning_only") is not True:
            errors.append("SF-M08-005: planning_only must remain true")

    for cg_id in ("SF-M06-CG-001", "SF-M08-CG-001"):
        cg = load_env("handovers", cg_id)
        decision = cg.get("decision") or {}
        if decision.get("status") != "FROZEN_ON_MAIN":
            errors.append(f"{cg_id}: decision.status must be FROZEN_ON_MAIN")
        if cg.get("repository_freeze_effective") is not True:
            errors.append(f"{cg_id}: repository_freeze_effective must be true")
        if cg.get("contracts_status") != "FROZEN":
            errors.append(f"{cg_id}: contracts_status must be FROZEN")
        if cg.get("freeze_status") != "FROZEN_ON_MAIN":
            errors.append(f"{cg_id}: freeze_status must be FROZEN_ON_MAIN")
        if cg.get("state") != "FROZEN_ON_MAIN" or cg.get("orchestration_task_state") != "FROZEN_ON_MAIN":
            errors.append(f"{cg_id}: state/orchestration_task_state must be FROZEN_ON_MAIN")
        if cg.get("implementation_authorized") is not False:
            errors.append(f"{cg_id}: implementation_authorized must be false")
        if cg.get("dispatched") is not False:
            errors.append(f"{cg_id}: dispatched must be false")
        if cg.get("builders_dispatched") not in (0, None) and cg.get("builders_dispatched") != 0:
            errors.append(f"{cg_id}: builders_dispatched must be 0")
        eligible = list(cg.get("wave_a_eligible_now") or [])
        if eligible != list(WAVE_A):
            errors.append(f"{cg_id}: wave_a_eligible_now must be exactly the seven READY lanes")
        if "SF-M08-005" in eligible:
            errors.append(f"{cg_id}: must not list SF-M08-005 in wave_a_eligible_now")
        if (cg.get("existing_frozen") or {}).get("result") != "MATCH":
            errors.append(f"{cg_id}: existing_frozen must remain MATCH")
        if (cg.get("lock_expected") or {}).get("frozen") != 29:
            errors.append(f"{cg_id}: lock_expected.frozen must be 29")
        if cg.get("ccr_required") is not False:
            errors.append(f"{cg_id}: ccr_required must be false")

    gate = subprocess.run(
        [sys.executable, str(ROOT / GATE_REL)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    (logs / "cg01_path_uniqueness_gate.log").write_text(gate.stdout + gate.stderr, encoding="utf-8")
    if gate.returncode != 0:
        errors.append(f"cg01_path_uniqueness_gate.py exit {gate.returncode}")

    summary = {
        "slice": "CG-02-WAVE-A-ACTIVATION",
        "parallel_set": list(WAVE_A),
        "pairwise_overlaps": len(overlap_hits),
        "forbidden_writers": len(forbidden),
        "pairs": pairs,
        "overlap_hits": overlap_hits,
        "forbidden": forbidden,
        "contract_locks_count": lock_counts,
        "ready_flags": ready_flags,
        "held_off": held_flags,
        "gate_script": GATE_REL,
        "gate_unchanged_vs_origin_main": gate_now == gate_main,
        "gate_sha256": sha256_bytes(gate_now),
        "contracts_lock_unchanged_vs_origin_main": lock_now == lock_main,
        "cg01_path_uniqueness_gate_exit": gate.returncode,
        "CG_02_WAVE_A_WRITE_PATH_UNIQUENESS": "PASS" if not errors and len(overlap_hits) == 0 and len(forbidden) == 0 else "FAIL",
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
                "CG_02_WAVE_A_WRITE_PATH_UNIQUENESS": summary["CG_02_WAVE_A_WRITE_PATH_UNIQUENESS"],
                "overlaps": len(overlap_hits),
                "forbidden": len(forbidden),
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
