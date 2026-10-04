#!/usr/bin/env python3
"""Additive workflow hygiene gate (Eng v1.4 CMP-055 failure modes: unpinned dep, secret in repo).

- Third-party `uses:` actions must be pinned to a 40-char commit SHA
- Workflow YAML must not embed obvious secret assignments (password/token/key literals)
Does not weaken existing security.yml / ci.yml jobs.
"""
from __future__ import annotations

import re
import sys

from _common import ROOT, Report, rel

USES = re.compile(r"^\s*-?\s*uses:\s*(.+?)\s*$")
# Allows owner/repo@sha and owner/repo/path@sha (e.g. github/codeql-action/init@…).
SHA_PINNED = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*@[0-9a-f]{40}$")
LOCAL_OR_DOCKER = re.compile(r"^(\./|docker://)")
# Fail closed on plaintext credential-looking assignments in workflow files.
SECRET_ASSIGN = re.compile(
    r"(?i)^\s*(password|token|secret|api[_-]?key|access[_-]?key)\s*:\s*['\"]?[^'\"${\s][^'\"]+['\"]?\s*$"
)
GITHUB_SECRET_OK = re.compile(r"\$\{\{\s*secrets\.")


def check_workflow(path, r: Report) -> None:
    name = rel(path)
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        m = USES.match(line)
        if m:
            ref = m.group(1).strip().strip("'\"")
            ref_no_comment = ref.split("#", 1)[0].strip()
            if LOCAL_OR_DOCKER.match(ref_no_comment):
                continue
            if not SHA_PINNED.match(ref_no_comment):
                r.error(f"{name}:{i}: action not pinned to 40-char SHA: {ref_no_comment}")
        if SECRET_ASSIGN.search(line) and not GITHUB_SECRET_OK.search(line):
            r.error(f"{name}:{i}: possible plaintext secret assignment")


def main() -> int:
    r = Report("workflow-pin")
    workflows = sorted((ROOT / ".github" / "workflows").glob("*.yml")) + sorted(
        (ROOT / ".github" / "workflows").glob("*.yaml")
    )
    if not workflows:
        r.error(".github/workflows has no workflow files")
    for path in workflows:
        check_workflow(path, r)
    r.note(f"{len(workflows)} workflow file(s) checked for pins and plaintext secrets")
    return r.finish()


if __name__ == "__main__":
    sys.exit(main())
