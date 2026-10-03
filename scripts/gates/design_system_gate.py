#!/usr/bin/env python3
"""UX4G conformance gate (DESIGN-SYSTEM.md rules 3 and 5; specs/design-system.yaml
prohibited_without_adr; ci/ARCHITECTURE-GATES.md "UX4G conformance gate").

1. No workspace package.json depends on another visual design system.
2. Web apps import UI only from @serviceform/ui-ux4g (no feature-local CSS files).
3. No hard-coded colour values in app or wrapper source outside the wrapper's token files.
4. The Flutter app does not depend on a third-party UI kit.
"""
from __future__ import annotations

import json
import re
import sys

from _common import ROOT, Report, rel, source_files

BANNED_NPM = re.compile(
    r"^(@mui/|@material-ui/|bootstrap$|react-bootstrap$|reactstrap$|antd$|@ant-design/|@chakra-ui/|"
    r"tailwindcss$|@tailwindcss/|@mantine/|semantic-ui|primereact$|@fluentui/|@blueprintjs/|"
    r"@headlessui/tailwindcss$|daisyui$|bulma$|@carbon/react$|@radix-ui/themes$)"
)
BANNED_PUB = re.compile(r"^\s{2}(getwidget|velocity_x|flutter_neumorphic|fluent_ui|macos_ui|shadcn_ui)\s*:", re.M)
COLOUR = re.compile(r"#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(")
TOKEN_FILES = {"packages/ui-ux4g/src/styles.css", "apps/mobile/lib/ux4g/tokens.dart"}


def main() -> int:
    r = Report("design-system")
    manifests = sorted(ROOT.glob("package.json")) + sorted(ROOT.glob("apps/*/package.json")) + sorted(ROOT.glob("packages/*/package.json")) + sorted(ROOT.glob("services/*/package.json"))
    for m in manifests:
        data = json.loads(m.read_text(encoding="utf-8"))
        for section in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
            for dep in data.get(section, {}):
                if BANNED_NPM.match(dep):
                    r.error(f"{rel(m)}: {section} includes {dep}; another visual design system needs an ADR (DESIGN-SYSTEM.md rule 5)")

    for css in source_files(["apps"], (".css", ".scss", ".sass", ".less")):
        r.error(f"{rel(css)}: feature-local stylesheet; styles come from @serviceform/ui-ux4g")

    for f in source_files(["apps", "packages/ui-ux4g"], (".ts", ".tsx", ".css", ".dart", ".mjs")):
        path = rel(f)
        if path in TOKEN_FILES or "/test/" in path or "/android/" in path or "/ios/" in path:
            continue
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            code = line.split("//", 1)[0]
            if COLOUR.search(code) or re.search(r"\bColor\(0x", code):
                r.error(f"{path}:{n}: hard-coded colour value; use UX4G tokens (DESIGN-SYSTEM.md rule 3)")

    pub = ROOT / "apps/mobile/pubspec.yaml"
    if pub.exists():
        for m in BANNED_PUB.finditer(pub.read_text(encoding="utf-8")):
            r.error(f"apps/mobile/pubspec.yaml: depends on UI kit {m.group(1)}")
        if re.search(r"uses-material-design:\s*true", pub.read_text(encoding="utf-8")):
            r.warn("apps/mobile/pubspec.yaml: Material design assets enabled; UI must still come from lib/ux4g")

    r.note(f"{len(manifests)} package manifests checked")
    return r.finish()


if __name__ == "__main__":
    sys.exit(main())
