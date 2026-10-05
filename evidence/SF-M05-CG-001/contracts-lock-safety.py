#!/usr/bin/env python3
"""Prove existing frozen 13 unchanged; six NEW M05 rows appended; 19/19 FROZEN."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
ORIGINAL_13 = [
    ("SF-CON-AUDIT-EVENT", "contracts/shared/schemas/audit-event.schema.json", "997fc6a97edcdcf0d29c060e033355a744421582e2868b9c42f01200c9ec1f71"),
    ("SF-CON-AUTHZ-DECISION", "contracts/shared/schemas/authz-decision.schema.json", "dc0e6a62423757c60b1ec2c135ac41c6e4198ed3df484d5bfb3a6326f2e00275"),
    ("SF-CON-COMMON", "contracts/shared/schemas/common.schema.json", "82d44cd5fd4d71f1985fdcd287737c6d1e7c63f67595ee750338754df0ca40b8"),
    ("SF-CON-CONNECTOR-BINDING", "contracts/shared/schemas/connector-binding.schema.json", "9a4c71b94b8088a09216db633ba4d823b8033b26adb5e005e7884d37eb8e59a0"),
    ("SF-CON-ERROR-RESPONSE", "contracts/shared/schemas/error-response.schema.json", "816837b6f741d47659820d816eefc0fedb0c37dadc063efc1921313092523b55"),
    ("SF-CON-EVENT-ENVELOPE", "contracts/shared/schemas/event-envelope.schema.json", "fbb012cc1c345c643b008e47e184e587931d6d7b72cfe0042c1eae98bbad9283"),
    ("SF-CON-IDEMPOTENCY", "contracts/shared/schemas/idempotency-record.schema.json", "3b126852ad01a86b7e31bfb10af386a95cf040b1fbcc184c5a6d2c140ebf64de"),
    ("SF-CON-ISOLATION-DECLARATION", "contracts/shared/schemas/isolation-declaration.schema.json", "8aa660966813ad8e16827d917927cf603373717723cd9ed664f27d891d47ac02"),
    ("SF-CON-REQUEST-CONTEXT", "contracts/shared/schemas/request-context.schema.json", "76894a7db855bb1cbd9b88246a6f3d5902274a09ce2080331895983c92abebec"),
    ("SF-CON-SIMULATION-MARKER", "contracts/shared/schemas/simulation-marker.schema.json", "e5c8f6869d65b7eda2bacf0ec1dfac5d1f14717daf7265fd2f6605d6f3604c62"),
    ("SF-CON-ERROR-CATALOGUE", "contracts/shared/error-catalogue.json", "4a89444f7cea8837dca1c90b2bd8025241b9207efb5d01936af448ea83e190fa"),
    ("SF-CON-DB-SESSION-CONTEXT", "contracts/shared/schemas/db-session-context.schema.json", "738ca80be8c24d488e98ae0e03f50425467a97b7249ae072e4adc2bb03d1b01a"),
    ("SF-CON-OUTBOX", "contracts/shared/schemas/outbox-record.schema.json", "b0afa1938cf7299579b4c8af684e46c43551c733a412f5198d8e01b5b9491ba4"),
]
ORIGINAL_COMPANIONS = {
    "SF-CON-DB-SESSION-CONTEXT": [
        ("db/migrations/1759490000000_shared-db-contracts.sql", "2e2354a00ce39c71f4195ab5838218dcfb827de1abc238622f32540093a92b0d")
    ],
    "SF-CON-OUTBOX": [
        ("contracts/shared/sql/outbox.template.sql", "4e1ad97dadf15e30a21db789c1d1bc4c32c4f45d6dae8e65515cc2c5d695fa21")
    ],
}
M05_IDS = [
    "SF-CON-APPLICATION-CASE-SM",
    "SF-CON-WORKFLOW-MODEL",
    "SF-CON-COMMAND-TRANSITION",
    "SF-CON-HUMAN-TASK",
    "SF-CON-SLA-CLOCK",
    "SF-CON-VERSION-PINNING",
]
OLD_PRE_FREEZE = {
    "SF-CON-APPLICATION-CASE-SM": "c00ce6c337c6b03244a927286eb37358fc5e2bc31f6eb3588b1ab78315fd341f",
    "SF-CON-WORKFLOW-MODEL": "d11ba54a6c74c1cc6117fd19106a84c3ad7a6a17031cc8e64239858016ab49a0",
    "SF-CON-COMMAND-TRANSITION": "c5bbc1dd28e6d096fea08c5aad76931a504818eee53f10d6b28c459c893bdb19",
    "SF-CON-HUMAN-TASK": "679f005b5b018c1887af6a083a35ee86c69f692bea23f944bb136d1c4e6a9f1f",
    "SF-CON-SLA-CLOCK": "f1b10d2ddf5ccf09e23cc3e8beb1dd2175721cf4c19ff40662cff39e5feed450",
    "SF-CON-VERSION-PINNING": "e641adf23379096e6f68a2e082926b829f57e1f3ba848630d00fbbb2a36ae019",
}

lock = yaml.safe_load((ROOT / "orchestrator/contracts-lock.yaml").read_text())
entries = lock["contracts"]
frozen = [e for e in entries if e.get("status") == "FROZEN"]
by_id = {e["id"]: e for e in entries}
lines = []


def log(s: str) -> None:
    lines.append(s)
    print(s)


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


fail = 0
log(f"lock_entries={len(entries)} frozen={len(frozen)}")
if len(entries) != 19 or len(frozen) != 19:
    fail += 1
    log(f"FAIL expected 19/19 FROZEN, got {len(entries)}/{len(frozen)}")
else:
    log("PASS lock 19/19 FROZEN")

changed = 0
for cid, path, expected in ORIGINAL_13:
    e = by_id.get(cid)
    if not e:
        fail += 1
        log(f"FAIL missing original {cid}")
        continue
    if e.get("status") != "FROZEN":
        fail += 1
        log(f"FAIL original {cid} status {e.get('status')}")
    if e.get("path") != path:
        fail += 1
        log(f"FAIL original {cid} path changed")
    if e.get("schema_hash") != expected:
        changed += 1
        fail += 1
        log(f"FAIL original lock hash changed {cid}")
    actual = sha(ROOT / path)
    if actual != expected:
        changed += 1
        fail += 1
        log(f"FAIL original file hash changed {cid}")
    for cpath, cexp in ORIGINAL_COMPANIONS.get(cid, []):
        companions = e.get("companions") or []
        hit = next((c for c in companions if c.get("path") == cpath), None)
        if not hit or hit.get("sha256") != cexp:
            changed += 1
            fail += 1
            log(f"FAIL companion lock {cid} {cpath}")
        if sha(ROOT / cpath) != cexp:
            changed += 1
            fail += 1
            log(f"FAIL companion file {cid} {cpath}")

if changed == 0:
    log("PASS original_13 hashes_changed=0")
else:
    log(f"FAIL original_13 hashes_changed={changed}")

shared_files = [p for p in (ROOT / "contracts/shared").rglob("*") if p.is_file()]
log(f"note contracts/shared file_count={len(shared_files)}")

for cid in M05_IDS:
    e = by_id.get(cid)
    if not e:
        fail += 1
        log(f"FAIL missing M05 lock row {cid}")
        continue
    if e.get("status") != "FROZEN":
        fail += 1
        log(f"FAIL {cid} status {e.get('status')}")
    p = ROOT / e["path"]
    actual = sha(p)
    if actual != e.get("schema_hash"):
        fail += 1
        log(f"FAIL lock/file hash mismatch {cid}")
    else:
        log(f"PASS m05 {cid} {actual}")
    if actual == OLD_PRE_FREEZE.get(cid):
        fail += 1
        log(f"FAIL reused pre-freeze hash {cid}")

if fail == 0:
    log("PASS M05 six NEW FROZEN rows; hashes recalculated")

out = ROOT / "evidence/SF-M05-CG-001/logs/contracts-lock-safety.log"
out.write_text("\n".join(lines) + "\n")
summary = {
    "lock_entries": len(entries),
    "frozen": len(frozen),
    "original_13_hashes_changed": changed,
    "ccr_required": False if fail == 0 else True,
    "fail": fail,
}
(ROOT / "evidence/SF-M05-CG-001/logs/contracts-lock-safety.json").write_text(json.dumps(summary, indent=2) + "\n")
sys.exit(1 if fail else 0)
