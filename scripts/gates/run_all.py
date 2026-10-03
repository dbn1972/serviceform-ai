#!/usr/bin/env python3
"""Runs every repository-level architecture gate and writes a JSON summary.

Usage: python3 scripts/gates/run_all.py [--json test-results/gates/summary.json]
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
GATES = [
    ("validate-specs", "validate_specs.py"),
    ("migration-lint", "migration_lint.py"),
    ("design-system", "design_system_gate.py"),
    ("no-hardcoded-jurisdictions", "hardcoding_gate.py"),
    ("contracts-lock", "contracts_lock_gate.py"),
    ("agent-rules", "agent_rules_gate.py"),
    ("codeowners", "codeowners_gate.py"),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=str(HERE.parents[1] / "test-results/gates/summary.json"))
    args = ap.parse_args()
    results = []
    for name, script in GATES:
        t0 = time.monotonic()
        p = subprocess.run([sys.executable, str(HERE / script)], capture_output=True, text=True, cwd=HERE)
        sys.stdout.write(p.stdout)
        sys.stderr.write(p.stderr)
        results.append({"gate": name, "exit_code": p.returncode, "seconds": round(time.monotonic() - t0, 2)})
    out = pathlib.Path(args.json)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"gates": results}, indent=2) + "\n", encoding="utf-8")
    failed = [r["gate"] for r in results if r["exit_code"] != 0]
    print(f"\n{len(results) - len(failed)}/{len(results)} gates passed" + (f"; failed: {', '.join(failed)}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
