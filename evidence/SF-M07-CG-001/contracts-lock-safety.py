#!/usr/bin/env python3
"""Prove the existing 29 frozen rows are unchanged and five NEW M07 rows are appended (34/34).

Baseline is the lock on origin/main (git show), so the comparison is against the merged tree,
not against values copied into this script.
Usage: python3 evidence/SF-M07-CG-001/contracts-lock-safety.py [baseline-ref]
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
BASE_REF = sys.argv[1] if len(sys.argv) > 1 else "origin/main"
NEW_IDS = [
    "SF-CON-CREDENTIAL",
    "SF-CON-SIGNING-RECORD",
    "SF-CON-CREDENTIAL-STATUS",
    "SF-CON-VERIFICATION-TOKEN",
    "SF-CON-DIGILOCKER-PUBLISH",
]
ROW_KEYS = ["id", "version", "status", "owner", "source", "path", "schema_hash", "producers", "consumers", "companions"]

lines: list[str] = []


def log(s: str) -> None:
    lines.append(s)
    print(s)


def sha(rel: str) -> str:
    return hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()


base_sha = subprocess.check_output(["git", "rev-parse", BASE_REF], cwd=ROOT, text=True).strip()
base_raw = subprocess.check_output(["git", "show", f"{BASE_REF}:orchestrator/contracts-lock.yaml"], cwd=ROOT, text=True)
base = yaml.safe_load(base_raw)
head_raw = (ROOT / "orchestrator/contracts-lock.yaml").read_text()
head = yaml.safe_load(head_raw)

base_entries = base["contracts"]
head_entries = head["contracts"]
fail = 0

log(f"baseline {BASE_REF} {base_sha} version={base.get('version')} entries={len(base_entries)}")
log(f"candidate version={head.get('version')} entries={len(head_entries)}")

if len(base_entries) != 29:
    fail += 1
    log(f"FAIL baseline expected 29 entries, got {len(base_entries)}")

prefix = head_entries[: len(base_entries)]
changed = 0
for b, h in zip(base_entries, prefix):
    diff = [k for k in ROW_KEYS if b.get(k) != h.get(k)]
    if diff:
        changed += 1
        fail += 1
        log(f"FAIL {b['id']} row changed keys={diff}")
        continue
    if sha(b["path"]) != b["schema_hash"]:
        changed += 1
        fail += 1
        log(f"FAIL {b['id']} file hash drift")
        continue
    for c in b.get("companions") or []:
        if sha(c["path"]) != c["sha256"]:
            changed += 1
            fail += 1
            log(f"FAIL companion {c['path']} hash drift")
    log(f"PASS {b['id']} unchanged {b['schema_hash']}")
if changed == 0:
    log("PASS existing_29 rows identical to baseline (order preserved) and hashes_changed=0")

appended = head_entries[len(base_entries):]
if [e["id"] for e in appended] != NEW_IDS:
    fail += 1
    log(f"FAIL appended ids {[e['id'] for e in appended]} != {NEW_IDS}")
else:
    log("PASS exactly five NEW M07 rows appended at end")
for e in appended:
    actual = sha(e["path"])
    ok = e.get("schema_hash") == actual and e.get("status") == "FROZEN" and e["path"].startswith("contracts/m07/")
    if not ok:
        fail += 1
        log(f"FAIL NEW {e['id']} hash/status/path mismatch")
    else:
        log(f"PASS NEW {e['id']} hash={actual}")

frozen = sum(1 for e in head_entries if e.get("status") == "FROZEN")
if len(head_entries) != 34 or frozen != 34:
    fail += 1
    log(f"FAIL expected 34/34 FROZEN, got {len(head_entries)}/{frozen}")
else:
    log("PASS lock 34/34 FROZEN (candidate)")

diff_out = subprocess.run(
    ["git", "diff", "--name-only", BASE_REF, "--", "contracts/shared", "contracts/m05", "contracts/m06", "contracts/m08", "db/migrations"],
    cwd=ROOT, text=True, capture_output=True, check=True,
).stdout.split()
if diff_out:
    fail += 1
    log(f"FAIL frozen-area files changed vs baseline: {diff_out}")
else:
    log("PASS contracts/shared, m05, m06, m08, db/migrations unchanged vs baseline")

for tok in ["APPEND-ONLY", "19_FROZEN_HASHES_MATCH", "29_FROZEN_CANDIDATE_HASHES_MATCH", "34_FROZEN_CANDIDATE_HASHES_MATCH"]:
    if tok not in head_raw:
        fail += 1
        log(f"FAIL lock missing token {tok}")
    else:
        log(f"PASS lock retains/declares {tok}")

summary = {
    "baseline_ref": BASE_REF,
    "baseline_sha": base_sha,
    "baseline_version": base.get("version"),
    "candidate_version": head.get("version"),
    "entries": len(head_entries),
    "frozen": frozen,
    "existing_29_hashes_changed": changed,
    "new_rows": [e["id"] for e in appended],
    "ccr_required": changed > 0,
    "lock_mode": "APPEND_NEW_M07_ROWS_ONLY",
    "result": "PASS" if fail == 0 else "FAIL",
}
outdir = ROOT / "evidence/SF-M07-CG-001/logs"
outdir.mkdir(parents=True, exist_ok=True)
(outdir / "contracts-lock-safety.log").write_text("\n".join(lines) + "\n")
(outdir / "contracts-lock-safety.json").write_text(json.dumps(summary, indent=2) + "\n")
log(json.dumps(summary))
sys.exit(1 if fail else 0)
