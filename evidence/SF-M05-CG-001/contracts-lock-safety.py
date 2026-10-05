#!/usr/bin/env python3
"""Prove existing frozen 13 unchanged; M05 drafts not in the lock."""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
lock = yaml.safe_load((ROOT / "orchestrator/contracts-lock.yaml").read_text())
entries = lock["contracts"]
frozen = [e for e in entries if e.get("status") == "FROZEN"]
lines = []


def log(s: str) -> None:
    lines.append(s)
    print(s)


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


fail = 0
log(f"lock_entries={len(entries)} frozen={len(frozen)}")
if len(frozen) != 13:
    fail += 1
    log(f"FAIL expected 13 FROZEN, got {len(frozen)}")
else:
    log("PASS frozen_count=13")

changed = 0
shared_changed = 0
m05_in_lock = []
for e in frozen:
    p = ROOT / e["path"]
    actual = sha(p)
    if actual != e["schema_hash"]:
        changed += 1
        fail += 1
        log(f"FAIL hash {e['id']} {e['path']}")
    for c in e.get("companions") or []:
        cp = ROOT / c["path"]
        if sha(cp) != c["sha256"]:
            changed += 1
            fail += 1
            log(f"FAIL companion {e['id']} {c['path']}")
    if str(e["path"]).startswith("contracts/shared/"):
        pass
    if str(e.get("id", "")).startswith("SF-CON-APPLICATION") or "m05" in str(e["path"]):
        m05_in_lock.append(e["id"])

if changed == 0:
    log("PASS hashes_changed=0")
else:
    log(f"FAIL hashes_changed={changed}")

# every file under contracts/shared vs git? compared to lock is enough.
shared_files = list((ROOT / "contracts/shared").rglob("*"))
shared_files = [p for p in shared_files if p.is_file()]
log(f"note contracts/shared file_count={len(shared_files)} (lock gate, not lock membership)")

catalog = yaml.safe_load if False else None
import json

cat = json.loads((ROOT / "contracts/m05/catalog.json").read_text())
for c in cat["contracts"]:
    if any(e["id"] == c["id"] for e in entries):
        m05_in_lock.append(c["id"])
        fail += 1
        log(f"FAIL M05 id {c['id']} present in contracts-lock (must not freeze yet)")

if not m05_in_lock:
    log("PASS no M05 contract ids in contracts-lock.yaml")

# hashes of proposed schemas
log("proposed_schema_sha256:")
for p in sorted((ROOT / "contracts/m05/schemas").glob("*.schema.json")):
    log(f"  {p.name} {sha(p)}")

out = ROOT / "evidence/SF-M05-CG-001/logs/contracts-lock-safety.log"
out.write_text("\n".join(lines) + "\n")
sys.exit(1 if fail else 0)
