#!/usr/bin/env python3
"""No hard-coded jurisdictions in domain logic (Constitution #3, AWS v1.7 s5).

Fails when production source under apps/, services/ or packages/ names an Indian State or
Union Territory. Tests, fixtures, seed metadata and docs are out of scope: jurisdiction data
belongs in versioned master data (CMP-003/034), not in code branches.
"""
from __future__ import annotations

import re
import sys

from _common import ROOT, Report, rel, source_files

JURISDICTIONS = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
    "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
    "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Orissa", "Punjab",
    "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
    "West Bengal", "Andaman and Nicobar", "Chandigarh", "Dadra and Nagar Haveli", "Daman and Diu",
    "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
]
PATTERN = re.compile(r"\b(" + "|".join(re.escape(j).replace(r"\ ", r"[\s_-]*") for j in JURISDICTIONS) + r")\b", re.I)
EXCLUDE = ("test", "tests", "fixtures", "seed", "seeds", "android", "ios")


def main() -> int:
    r = Report("no-hardcoded-jurisdictions")
    files = source_files(["apps", "services", "packages"], (".ts", ".tsx", ".mjs", ".js", ".dart", ".sql"), EXCLUDE)
    for f in files:
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            m = PATTERN.search(line)
            if m:
                r.error(f"{rel(f)}:{n}: names jurisdiction '{m.group(1)}' in source; use master data (Constitution #3)")
    r.note(f"{len(files)} source file(s) scanned")
    return r.finish()


if __name__ == "__main__":
    sys.exit(main())
