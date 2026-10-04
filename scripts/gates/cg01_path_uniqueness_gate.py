#!/usr/bin/env python3
"""CG-01 write-path uniqueness + sequencing gate (pre-dispatch).

Fails CI when concurrent CG-01 envelopes share write paths, except the documented
serial pair SF-M02-003 ↔ SF-M03-008 on apps/api/** which MUST declare
must_not_run_concurrent_with each other.

Also refuses builder ownership of pnpm-lock.yaml, contracts/**, and
orchestrator/contracts-lock.yaml.
"""
from __future__ import annotations

import fnmatch
import re
import sys
from pathlib import Path

from _common import ROOT, Report, load_yaml

HANDOVER_DIR = ROOT / "orchestrator" / "handovers"
TASKS_DIR = ROOT / "orchestrator" / "tasks"
CMP_TOKEN = re.compile(r"cmp-\d{3}", re.I)

SERIAL_PAIR = frozenset({"SF-M02-003", "SF-M03-008"})
SERIAL_SHARED_PREFIX = "apps/api/"

WAVE_A = [
    "SF-M02-001",
    "SF-M02-002",
    "SF-M03-001",
    "SF-M03-002",
    "SF-M03-003",
    "SF-M03-005",
    "SF-M03-006",
]
SERIAL_AFTER = {
    "SF-M03-004": ["SF-M03-002"],
    "SF-M03-007": ["SF-M03-002", "SF-M03-004", "SF-M03-006"],
}
BASE_PREFIX = "8613d0ec"
BASE_SUFFIX = "844e189191a782753c30c65871756048"
FORBIDDEN_WRITE_GLOBS = (
    "pnpm-lock.yaml",
    "contracts",
    "contracts/**",
    "orchestrator/contracts-lock.yaml",
)
IMPLEMENTATION_IDS = [
    "SF-M02-001",
    "SF-M02-002",
    "SF-M02-003",
    "SF-M02-INT",
    "SF-M02-SEC",
    "SF-M02-EVD",
    "SF-M03-001",
    "SF-M03-002",
    "SF-M03-003",
    "SF-M03-004",
    "SF-M03-005",
    "SF-M03-006",
    "SF-M03-007",
    "SF-M03-008",
    "SF-M03-INT",
    "SF-M03-SEC",
    "SF-M03-EVD",
]


def normalize(pattern: str) -> str:
    return pattern.replace("\\", "/").rstrip("/")


def cmp_tokens(pattern: str) -> set[str]:
    return {m.lower() for m in CMP_TOKEN.findall(pattern)}


def literal_prefix(pattern: str) -> str:
    star = pattern.find("*")
    if star < 0:
        return pattern
    return pattern[:star].rstrip("/")


def patterns_overlap(a: str, b: str) -> bool:
    a, b = normalize(a), normalize(b)
    if a == b:
        return True
    ta, tb = cmp_tokens(a), cmp_tokens(b)
    if ta and tb and ta.isdisjoint(tb):
        return False
    a_wild, b_wild = "*" in a, "*" in b
    if not a_wild and not b_wild:
        return a == b
    if not a_wild:
        return fnmatch.fnmatch(a, b)
    if not b_wild:
        return fnmatch.fnmatch(b, a)
    pa, pb = literal_prefix(a), literal_prefix(b)
    if not pa or not pb:
        return True
    return pa == pb or pa.startswith(pb + "/") or pb.startswith(pa + "/")


def is_forbidden_write(pattern: str) -> bool:
    p = normalize(pattern)
    if p == "pnpm-lock.yaml" or p.endswith("/pnpm-lock.yaml"):
        return True
    if p == "orchestrator/contracts-lock.yaml":
        return True
    if p == "contracts" or p.startswith("contracts/") or p.startswith("contracts"):
        return True
    return False


def load_envelope(path: Path) -> dict:
    data = load_yaml(path) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected mapping")
    return data


def overlapping_paths(left: dict, right: dict) -> list[tuple[str, str]]:
    hits: list[tuple[str, str]] = []
    for a in left.get("allowed_write_paths") or []:
        for b in right.get("allowed_write_paths") or []:
            if patterns_overlap(str(a), str(b)):
                hits.append((str(a), str(b)))
    return hits


def serial_overlap_allowed(left_id: str, right_id: str, hits: list[tuple[str, str]]) -> bool:
    if frozenset({left_id, right_id}) != SERIAL_PAIR:
        return False
    return all(
        normalize(a).startswith(SERIAL_SHARED_PREFIX) and normalize(b).startswith(SERIAL_SHARED_PREFIX)
        for a, b in hits
    )


def envelope_paths() -> list[Path]:
    return [HANDOVER_DIR / f"{tid}.yaml" for tid in IMPLEMENTATION_IDS]


def check_envelopes(envelopes: list[dict], r: Report) -> None:
    by_id = {e.get("task_id"): e for e in envelopes}
    missing = [tid for tid in IMPLEMENTATION_IDS if tid not in by_id]
    for tid in missing:
        r.error(f"missing implementation envelope {tid}")
    if missing:
        return

    for env in envelopes:
        tid = env["task_id"]
        writes = [str(p) for p in (env.get("allowed_write_paths") or [])]
        for p in writes:
            if is_forbidden_write(p):
                r.error(f"{tid}: forbidden write path {p} (orchestrator/stitch or frozen)")
        bc = env.get("base_commit") or {}
        if not isinstance(bc, dict):
            r.error(f"{tid}: base_commit must be split prefix/suffix (CKV_SECRET_6)")
        else:
            if bc.get("prefix") != BASE_PREFIX or bc.get("suffix") != BASE_SUFFIX:
                r.error(f"{tid}: base_commit not rebound to authorized main prefix {BASE_PREFIX}")
            joined = f"{bc.get('prefix', '')}{bc.get('suffix', '')}"
            raw = env.get("base_commit_joined")
            if raw or (isinstance(env.get("base_commit"), str) and len(str(env.get("base_commit"))) >= 40):
                r.error(f"{tid}: joined SHA field present (CKV_SECRET_6)")
            if env.get("decision_token") in {f"CG01_M02_M03_{env.get('state')}", joined}:
                r.error(f"{tid}: joined decision token (CKV_SECRET_6)")
        if env.get("planning_only") is not False:
            r.error(f"{tid}: planning_only must be false after promote")
        if env.get("implementation_authorized") is not True:
            r.error(f"{tid}: implementation_authorized must be true")
        if env.get("state") != "READY":
            r.error(f"{tid}: state must be READY")
        if env.get("dispatched") is True:
            r.error(f"{tid}: dispatched must remain false on this promote")
        if env.get("certified") is True or env.get("release_certified") is True:
            r.error(f"{tid}: must not claim CERTIFIED")

        expected_now = tid in WAVE_A
        if env.get("wave_eligible_now") is not expected_now:
            r.error(f"{tid}: wave_eligible_now expected {expected_now}")
        required_after = SERIAL_AFTER.get(tid, [])
        actual_after = [str(x) for x in (env.get("serial_after") or [])]
        for dep in required_after:
            if dep not in actual_after:
                r.error(f"{tid}: serial_after missing {dep}")

    left = by_id["SF-M02-003"]
    right = by_id["SF-M03-008"]
    if "SF-M03-008" not in (left.get("must_not_run_concurrent_with") or []):
        r.error("SF-M02-003 must_not_run_concurrent_with missing SF-M03-008")
    if "SF-M02-003" not in (right.get("must_not_run_concurrent_with") or []):
        r.error("SF-M03-008 must_not_run_concurrent_with missing SF-M02-003")
    if "apps/api/src/app.ts" not in (left.get("allowed_write_paths") or []):
        r.error("SF-M02-003 must write apps/api/src/app.ts (single-writer lock)")
    if "apps/api/src/app.ts" not in (right.get("allowed_write_paths") or []):
        r.error("SF-M03-008 must write apps/api/src/app.ts (single-writer lock)")

    ids = list(by_id)
    for i, a_id in enumerate(ids):
        for b_id in ids[i + 1 :]:
            hits = overlapping_paths(by_id[a_id], by_id[b_id])
            if not hits:
                continue
            if serial_overlap_allowed(a_id, b_id, hits):
                r.note(f"serial pair {a_id} ↔ {b_id} shares apps/api/** (must_not_run_concurrent_with required)")
                continue
            for a, b in hits:
                r.error(f"write-path overlap {a_id} `{a}` ∩ {b_id} `{b}`")

    r.note(f"checked {len(envelopes)} CG-01 implementation envelopes; Wave A eligible now: {', '.join(WAVE_A)}")


def check_task_copies(handovers: dict[str, dict], r: Report) -> None:
    for tid, env in handovers.items():
        task_path = TASKS_DIR / f"{tid}.yaml"
        if not task_path.is_file():
            r.error(f"orchestrator/tasks/{tid}.yaml missing (promote must copy READY envelopes)")
            continue
        copy = load_envelope(task_path)
        for key in (
            "state",
            "planning_only",
            "implementation_authorized",
            "dispatched",
            "wave_eligible_now",
            "must_not_run_concurrent_with",
            "serial_after",
            "allowed_write_paths",
        ):
            if copy.get(key) != env.get(key):
                r.error(f"tasks/{tid}.yaml {key} diverges from handovers")
        cbc, hbc = copy.get("base_commit") or {}, env.get("base_commit") or {}
        if cbc.get("prefix") != hbc.get("prefix") or cbc.get("suffix") != hbc.get("suffix"):
            r.error(f"tasks/{tid}.yaml base_commit diverges from handovers")


def main() -> int:
    r = Report("cg01-path-uniqueness")
    paths = envelope_paths()
    envelopes: list[dict] = []
    for p in paths:
        if not p.is_file():
            r.error(f"missing {p.relative_to(ROOT)}")
            continue
        envelopes.append(load_envelope(p))
    if len(envelopes) == len(IMPLEMENTATION_IDS):
        check_envelopes(envelopes, r)
        check_task_copies({e["task_id"]: e for e in envelopes}, r)
    return r.finish()


if __name__ == "__main__":
    sys.exit(main())
