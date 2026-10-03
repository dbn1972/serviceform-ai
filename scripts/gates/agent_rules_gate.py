#!/usr/bin/env python3
"""Keeps the agent instruction surfaces active (prompt 01: "Ensure AGENTS.md and .cursor/rules/
remain active"; Eng v1.4 s9.3). Each must exist, be non-empty and point at the common rules."""
from __future__ import annotations

import sys

from _common import ROOT, Report

REQUIRED = {
    "AGENTS.md": ["ARCHITECTURE-CONSTITUTION.md"],
    "CLAUDE.md": ["AGENTS.md", "ARCHITECTURE-CONSTITUTION.md"],
    "ARCHITECTURE-CONSTITUTION.md": [],
    ".github/copilot-instructions.md": ["AGENTS.md"],
    "MASTER_CURSOR_PROMPT.md": [],
}
MIN_CURSOR_RULES = 10


def main() -> int:
    r = Report("agent-rules")
    for path, must_cite in REQUIRED.items():
        f = ROOT / path
        if not f.is_file() or not f.read_text(encoding="utf-8").strip():
            r.error(f"{path} is missing or empty")
            continue
        text = f.read_text(encoding="utf-8")
        for ref in must_cite:
            if ref not in text:
                r.error(f"{path} no longer references {ref}")
    rules = sorted((ROOT / ".cursor/rules").glob("*.mdc"))
    if len(rules) < MIN_CURSOR_RULES:
        r.error(f".cursor/rules has {len(rules)} rule files; expected at least {MIN_CURSOR_RULES}")
    for rule in rules:
        if not rule.read_text(encoding="utf-8").startswith("---"):
            r.error(f"{rule.relative_to(ROOT)} lacks front matter, so Cursor will not apply it")
    agents = sorted((ROOT / ".claude/agents").glob("*.md"))
    if not agents:
        r.error(".claude/agents has no subagent definitions")
    r.note(f"{len(rules)} cursor rules, {len(agents)} Claude subagents")
    return r.finish()


if __name__ == "__main__":
    sys.exit(main())
