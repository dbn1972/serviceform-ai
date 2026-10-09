#!/usr/bin/env python3
"""Prove existing frozen 19 unchanged; ten NEW CG-02 rows appended; 29/29 FROZEN_CANDIDATE."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
ORIGINAL_19 = [
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
    ("SF-CON-APPLICATION-CASE-SM", "contracts/m05/schemas/application-case-sm.schema.json", "9b9fb73750a258d3f8f0bccb3182961f54b41f0b6da0570ea954a53aaf4e9ed7"),
    ("SF-CON-WORKFLOW-MODEL", "contracts/m05/schemas/workflow-model.schema.json", "71b20b1803525991a72c3983de0b0c7f7efa8cb76e37c31089f3978e994e2015"),
    ("SF-CON-COMMAND-TRANSITION", "contracts/m05/schemas/command-transition.schema.json", "07b05c9398cf38883d1c7eac20623633ab977d9d5c1b394d3f247fe842ecdd35"),
    ("SF-CON-HUMAN-TASK", "contracts/m05/schemas/human-task.schema.json", "2413c7af61453379920bbacc9635388c836262d6df46873497258efbe049ead2"),
    ("SF-CON-SLA-CLOCK", "contracts/m05/schemas/sla-clock.schema.json", "7a710d662ea77559cc52ec91d45e93f35d96fefc61a3b40903e4cd9cf1249d40"),
    ("SF-CON-VERSION-PINNING", "contracts/m05/schemas/version-pinning.schema.json", "54e69aa1250b776eba8bb764f8d14e0e2d16cd5e088200ba31613eaa280720f8"),
]
ORIGINAL_COMPANIONS = {
    "SF-CON-DB-SESSION-CONTEXT": [
        ("db/migrations/1759490000000_shared-db-contracts.sql", "2e2354a00ce39c71f4195ab5838218dcfb827de1abc238622f32540093a92b0d")
    ],
    "SF-CON-OUTBOX": [
        ("contracts/shared/sql/outbox.template.sql", "4e1ad97dadf15e30a21db789c1d1bc4c32c4f45d6dae8e65515cc2c5d695fa21")
    ],
}
NEW_IDS = [
    "SF-CON-FEE-QUOTE",
    "SF-CON-PAYMENT-INTENT",
    "SF-CON-PAYMENT-CALLBACK",
    "SF-CON-NOTIFICATION-DISPATCH",
    "SF-CON-MESSAGE-THREAD",
    "SF-CON-SEARCH-DOCUMENT",
    "SF-CON-DISCOVERY-QUERY",
    "SF-CON-RECOMMENDATION",
    "SF-CON-ANALYTICS-METRIC",
    "SF-CON-RETENTION-POLICY",
]

lock = yaml.safe_load((ROOT / "orchestrator/contracts-lock.yaml").read_text())
entries = lock["contracts"]
frozen = [e for e in entries if e.get("status") == "FROZEN"]
by_id = {e["id"]: e for e in entries}
lines = []


def log(s: str) -> None:
    lines.append(s)
    print(s)


def sha(rel: str) -> str:
    return hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()


fail = 0
if len(entries) != 29 or len(frozen) != 29:
    fail += 1
    log(f"FAIL expected 29/29 FROZEN, got {len(entries)}/{len(frozen)}")
else:
    log("PASS lock 29/29 FROZEN")

changed = 0
for cid, path, expected in ORIGINAL_19:
    e = by_id.get(cid)
    if not e:
        fail += 1
        log(f"FAIL missing existing {cid}")
        continue
    actual = sha(path)
    if e.get("schema_hash") != expected or actual != expected:
        fail += 1
        changed += 1
        log(f"FAIL {cid} hash drift")
    else:
        log(f"PASS {cid} unchanged")
    for cpath, chash in ORIGINAL_COMPANIONS.get(cid, []):
        if sha(cpath) != chash:
            fail += 1
            changed += 1
            log(f"FAIL companion {cpath} changed")

if changed == 0:
    log("PASS existing_19 hashes_changed=0")

for cid in NEW_IDS:
    e = by_id.get(cid)
    if not e:
        fail += 1
        log(f"FAIL missing NEW {cid}")
        continue
    actual = sha(e["path"])
    if e.get("schema_hash") != actual:
        fail += 1
        log(f"FAIL NEW {cid} lock hash mismatch")
    else:
        log(f"PASS NEW {cid} hash={actual}")

raw = (ROOT / "orchestrator/contracts-lock.yaml").read_text()
if "APPEND-ONLY" not in raw:
    fail += 1
    log("FAIL lock missing APPEND-ONLY comment")
else:
    log("PASS lock documents APPEND-ONLY")
if "19_FROZEN_HASHES_MATCH" not in raw:
    fail += 1
    log("FAIL missing baseline 19_FROZEN_HASHES_MATCH token")
else:
    log("PASS baseline 19_FROZEN_HASHES_MATCH retained")
if "29_FROZEN_CANDIDATE_HASHES_MATCH" not in raw:
    fail += 1
    log("FAIL missing candidate_result token")
else:
    log("PASS candidate_result present")

summary = {
    "entries": len(entries),
    "frozen": len(frozen),
    "existing_19_hashes_changed": changed,
    "ccr_required": changed > 0,
    "result": "PASS" if fail == 0 else "FAIL",
    "lock_mode": "APPEND_NEW_CG02_ROWS_ONLY",
}
for rel in [
    "evidence/SF-M06-CG-001/logs",
    "evidence/SF-M08-CG-001/logs",
]:
    outdir = ROOT / rel
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "contracts-lock-safety.log").write_text("\n".join(lines) + "\n")
    (outdir / "contracts-lock-safety.json").write_text(json.dumps(summary, indent=2) + "\n")
log(json.dumps(summary))
sys.exit(1 if fail else 0)
