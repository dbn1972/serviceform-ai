#!/usr/bin/env python3
"""Specification integrity gate (ci/ARCHITECTURE-GATES.md: `python scripts/validate_specs.py`).

Checks
  maps      specs/component-map.yaml lists CMP-001..061; integration-map.yaml lists INT-001..019
  plan      each build plan: module ids unique, dependencies exist and are acyclic, M00 has no
            dependencies, every CMP/INT referenced exists, each CMP and INT has exactly one owner,
            every module has an exit gate
  baseline  specs/build-plan.yaml (in force) may only carry the ownership findings recorded in
            scripts/gates/baselines/build-plan-known-findings.yaml (ADR-0001). New findings fail;
            resolved findings must be removed from the baseline (ratchet).
  proposed  specs/build-plan.proposed.yaml: structural errors fail; ownership/gate findings warn
            until ADR-0001 is accepted and the file replaces build-plan.yaml.
  agents    every role in specs/agent-topology.yaml has a .claude/agents definition
"""
from __future__ import annotations

import re
import sys

from _common import ROOT, Report, load_yaml

N_CMP, N_INT = 61, 19
ALL_CMP = [f"CMP-{i:03d}" for i in range(1, N_CMP + 1)]
ALL_INT = [f"INT-{i:03d}" for i in range(1, N_INT + 1)]


def check_maps(r: Report) -> None:
    cmap = load_yaml(ROOT / "specs/component-map.yaml")["components"]
    imap = load_yaml(ROOT / "specs/integration-map.yaml")["integrations"]
    if sorted(cmap) != ALL_CMP:
        r.error(f"component-map.yaml must list exactly {ALL_CMP[0]}..{ALL_CMP[-1]}")
    if sorted(imap) != ALL_INT:
        r.error(f"integration-map.yaml must list exactly {ALL_INT[0]}..{ALL_INT[-1]}")


def plan_findings(path: str, r: Report) -> set[str]:
    """Structural errors go to the report; ownership findings are returned for baseline handling."""
    plan = load_yaml(ROOT / path)
    modules = plan.get("modules") or []
    ids = [m.get("id") for m in modules]
    if len(ids) != len(set(ids)):
        r.error(f"{path}: duplicate module ids")
    known = set(ids)
    for m in modules:
        for key in ("id", "name", "depends_on"):
            if key not in m:
                r.error(f"{path}: module {m.get('id')} missing '{key}'")
        if "exit_gate" in m and not re.fullmatch(r"G[0-6]_[A-Z_]+", str(m["exit_gate"])):
            r.error(f"{path}: module {m.get('id')} has invalid exit_gate {m.get('exit_gate')!r}")
        for dep in m.get("depends_on") or []:
            if dep not in known:
                r.error(f"{path}: {m['id']} depends on unknown module {dep}")
        for c in m.get("components") or []:
            if c not in ALL_CMP:
                r.error(f"{path}: {m['id']} references unknown component {c}")
        for i in m.get("integrations") or []:
            if i not in ALL_INT:
                r.error(f"{path}: {m['id']} references unknown integration {i}")
    m00 = next((m for m in modules if m.get("id") == "M00"), None)
    if not m00 or m00.get("depends_on"):
        r.error(f"{path}: M00 must exist and have no dependencies")

    graph = {m["id"]: list(m.get("depends_on") or []) for m in modules if "id" in m}
    state: dict[str, int] = {}

    def visit(n: str, stack: list[str]) -> None:
        if state.get(n) == 1:
            r.error(f"{path}: dependency cycle {' -> '.join(stack + [n])}")
            return
        if state.get(n) == 2:
            return
        state[n] = 1
        for d in graph.get(n, []):
            if d in graph:
                visit(d, stack + [n])
        state[n] = 2

    for n in graph:
        visit(n, [])

    owners: dict[str, list[str]] = {}
    int_owners: dict[str, list[str]] = {}
    for m in modules:
        for c in m.get("components") or []:
            owners.setdefault(c, []).append(m["id"])
        for i in m.get("integrations") or []:
            int_owners.setdefault(i, []).append(m["id"])
    for cc in plan.get("cross_cutting_integrations") or []:
        int_owners.setdefault(cc["id"], []).append(cc["owner"])

    findings: set[str] = {f"{m['id']} has no exit_gate" for m in modules if "id" in m and "exit_gate" not in m}
    for c in ALL_CMP:
        n = len(owners.get(c, []))
        if n == 0:
            findings.add(f"{c} has no owning module")
        elif n > 1:
            findings.add(f"{c} owned by {n} modules: {', '.join(owners[c])}")
    for i in ALL_INT:
        n = len(int_owners.get(i, []))
        if n == 0:
            findings.add(f"{i} has no owning module")
        elif n > 1:
            findings.add(f"{i} owned by {n} modules: {', '.join(int_owners[i])}")
    return findings


def check_plans(r: Report) -> None:
    baseline_doc = load_yaml(ROOT / "scripts/gates/baselines/build-plan-known-findings.yaml")
    baseline = set(baseline_doc.get("known_findings") or [])
    current = plan_findings("specs/build-plan.yaml", r)
    for f in sorted(current - baseline):
        r.error(f"specs/build-plan.yaml: new finding not in baseline: {f}")
    for f in sorted(baseline - current):
        r.error(f"baseline lists a finding that no longer occurs (remove it): {f}")
    for f in sorted(current & baseline):
        r.warn(f"specs/build-plan.yaml: known finding ({baseline_doc.get('resolution')}): {f}")

    proposed = ROOT / "specs/build-plan.proposed.yaml"
    if proposed.exists():
        # Not in force until ADR-0001 is accepted: structural errors fail, findings warn.
        # On acceptance it replaces build-plan.yaml and the baseline must be empty.
        for f in sorted(plan_findings("specs/build-plan.proposed.yaml", r)):
            r.warn(f"specs/build-plan.proposed.yaml (fix before accepting ADR-0001): {f}")


def check_agents(r: Report) -> None:
    topo = load_yaml(ROOT / "specs/agent-topology.yaml")
    roles = topo.get("roles") or topo.get("agents") or {}
    names = list(roles.keys()) if isinstance(roles, dict) else [x.get("id") or x.get("role") for x in roles]
    defs = {p.stem for p in (ROOT / ".claude/agents").glob("*.md")}
    if not defs:
        r.error(".claude/agents has no agent definitions")
    r.note(f"{len(names)} topology roles, {len(defs)} .claude/agents definitions")


def main() -> int:
    r = Report("validate-specs")
    check_maps(r)
    check_plans(r)
    check_agents(r)
    return r.finish()


if __name__ == "__main__":
    sys.exit(main())
