#!/usr/bin/env python3
"""Static scans on the SF-M07-CG-001 freeze-prep write set (not a secret scanner)."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "contracts/m07/schemas"
EXAMPLES = ROOT / "contracts/m07/examples"

fail = 0
lines: list[str] = []


def log(s: str) -> None:
    lines.append(s)
    print(s)


FORBIDDEN_SCHEMA_TOKENS = [
    "officer_name", "named_officer", "employee_name",
    "holder_name", "aadhaar", "date_of_birth", "mobile_number",
    "validity_days", "validity_years", "revocation_grounds",
]
for f in sorted(SCHEMAS.glob("*.schema.json")):
    text = f.read_text(encoding="utf-8")
    if '"const": "PROPOSED"' in text:
        fail += 1
        log(f"FAIL {f.name} still PROPOSED")
    if '"const": "FROZEN"' not in text:
        fail += 1
        log(f"FAIL {f.name} missing FROZEN const")
    low = text.lower()
    hits = [t for t in FORBIDDEN_SCHEMA_TOKENS if t in low]
    if hits:
        fail += 1
        log(f"FAIL {f.name} contains forbidden tokens {hits}")
    else:
        log(f"PASS {f.name} no PII field names / named officials / invented statutory period fields")

identifier_re = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-f0-9]{64}", re.I)
pii_like = re.compile(r"\b\d{12}\b|\b[6-9]\d{9}\b|@[a-z0-9-]+\.[a-z]{2,}", re.I)
for f in sorted(EXAMPLES.rglob("*.json")):
    raw = f.read_text(encoding="utf-8")
    json.loads(raw)
    text = identifier_re.sub("", raw)
    if pii_like.search(text):
        fail += 1
        log(f"FAIL {f.relative_to(ROOT)} contains PII-like value")
    else:
        log(f"PASS {f.relative_to(ROOT)} synthetic only")

log(f"\nstatic-scan failures={fail}")
out = ROOT / "evidence/SF-M07-CG-001/logs"
out.mkdir(parents=True, exist_ok=True)
(out / "static-scan.log").write_text("\n".join(lines) + "\n")
sys.exit(1 if fail else 0)
