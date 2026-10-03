#!/usr/bin/env python3
"""Fails a change that writes outside its task envelope (MULTI-AGENT-DEVELOPMENT.md,
orchestrator/templates/task-envelope.yaml).

Usage (CI, on a PR branch whose head commit names the task, or explicitly):
  python scripts/gates/check_scope.py --envelope orchestrator/tasks/SF-M01-001.yaml --base origin/main
  python scripts/gates/check_scope.py --envelope ENV.yaml --files a.ts b.ts     # explicit list

Allowed for every task: `allowed_write_paths`, plus `orchestrator/handovers/<task>.yaml` and
`evidence/<task>/**`. Always refused: `read_only_paths`, and other `orchestrator/**` paths.
A change with no envelope (orchestrator or guardian work) is governed by CODEOWNERS instead.
"""
from __future__ import annotations

import argparse
import fnmatch
import subprocess
import sys

from _common import Report, load_yaml


def changed_files(base: str) -> list[str]:
    out = subprocess.run(["git", "diff", "--name-only", f"{base}...HEAD"], check=True, capture_output=True, text=True).stdout
    return [line for line in out.splitlines() if line]


def matches(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, p) or path.startswith(p.rstrip("*").rstrip("/") + "/") for p in patterns if p)


def violations(envelope: dict, files: list[str]) -> list[str]:
    task = envelope["task_id"]
    allowed = list(envelope.get("allowed_write_paths") or [])
    allowed += [f"orchestrator/handovers/{task}.yaml", f"evidence/{task}/**"]
    read_only = list(envelope.get("read_only_paths") or [])
    out = []
    for f in files:
        if matches(f, read_only):
            out.append(f"{f}: read-only for {task}")
        elif f.startswith("orchestrator/") and f != f"orchestrator/handovers/{task}.yaml":
            out.append(f"{f}: only the orchestrator writes orchestrator/**")
        elif not matches(f, allowed):
            out.append(f"{f}: outside allowed_write_paths of {task}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--envelope", required=True)
    ap.add_argument("--base", default="origin/main")
    ap.add_argument("--files", nargs="*")
    args = ap.parse_args()
    from pathlib import Path

    env = load_yaml(Path(args.envelope))
    r = Report("scope")
    files = args.files if args.files is not None else changed_files(args.base)
    for v in violations(env, files):
        r.error(v)
    r.note(f"{len(files)} changed file(s) checked against {env['task_id']}")
    return r.finish()


if __name__ == "__main__":
    sys.exit(main())
