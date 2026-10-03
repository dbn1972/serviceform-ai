#!/usr/bin/env python3
"""Contract lock gate (orchestrator/contracts-lock.yaml; MULTI-AGENT-DEVELOPMENT.md).

Every entry names an existing file; FROZEN entries must match their recorded SHA-256, so a
frozen contract cannot change without a change request that updates the lock.
"""
from __future__ import annotations

import hashlib
import sys

from _common import ROOT, Report, load_yaml

STATUSES = {"DRAFT", "FROZEN", "DEPRECATED"}


def main() -> int:
    r = Report("contracts-lock")
    lock = load_yaml(ROOT / "orchestrator/contracts-lock.yaml") or {}
    entries = lock.get("contracts") or []
    for e in entries:
        cid, status, path = e.get("id"), e.get("status"), e.get("path")
        if status not in STATUSES:
            r.error(f"{cid}: status {status!r} not in {sorted(STATUSES)}")
        f = ROOT / str(path)
        if not path or not f.is_file():
            r.error(f"{cid}: path {path!r} does not exist")
            continue
        actual = hashlib.sha256(f.read_bytes()).hexdigest()
        if status == "FROZEN" and actual != e.get("schema_hash"):
            r.error(f"{cid}: FROZEN contract {path} changed (sha256 {actual[:12]}... != lock {str(e.get('schema_hash'))[:12]}...)")
        elif status == "DRAFT" and actual != e.get("schema_hash"):
            r.warn(f"{cid}: DRAFT hash in lock is stale; refresh it when the change is reviewed")
    frozen = sum(1 for e in entries if e.get("status") == "FROZEN")
    r.note(f"{len(entries)} contract(s) in lock, {frozen} FROZEN")
    return r.finish()


if __name__ == "__main__":
    sys.exit(main())
