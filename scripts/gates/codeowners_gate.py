#!/usr/bin/env python3
"""CODEOWNERS covers the protected paths (Eng v1.4 s20.3; ARCHITECTURE-VERIFICATION-001 M-06)."""
from __future__ import annotations

import sys

from _common import ROOT, Report

PROTECTED = [
    "/ARCHITECTURE-CONSTITUTION.md",
    "/AGENTS.md",
    "/specs/",
    "/contracts/",
    "/docs/adr/",
    "/docs/authoritative/",
    "/db/migrations/",
    "/policy/",
    "/orchestrator/contracts-lock.yaml",
    "/scripts/gates/",
    "/.github/workflows/",
    "/.github/CODEOWNERS",
    "/infra/",
]


def main() -> int:
    r = Report("codeowners")
    f = ROOT / ".github/CODEOWNERS"
    if not f.is_file():
        r.error(".github/CODEOWNERS missing")
        return r.finish()
    patterns = {}
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            parts = line.split()
            patterns[parts[0]] = parts[1:]
    for p in PROTECTED:
        owners = patterns.get(p)
        if not owners:
            r.error(f"CODEOWNERS has no owner for {p}")
    return r.finish()


if __name__ == "__main__":
    sys.exit(main())
