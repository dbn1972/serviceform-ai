#!/usr/bin/env python3
"""Regenerate vendored UX4G 3.0 token CSS/JSON from ux4g-web-components styles/ux4g.css."""

from __future__ import annotations

import json
import re
import sys
from collections import OrderedDict
from pathlib import Path

NEEDLES = (
    "ux4g-btn",
    "ux4g-input",
    "ux4g-checkbox",
    "ux4g-radio",
    "ux4g-switch",
    "ux4g-alert",
    "ux4g-card",
    "ux4g-text-link",
    "ux4g-badge",
    "ux4g-heading",
    "ux4g-body-",
    "ux4g-navbar",
    "ux4g-footer",
    "ux4g-breadcrumb",
    "ux4g-label",
    "ux4g-form",
    "ux4g-field",
    "focus-visible",
    "ux4g-sr-only",
    "ux4g-tag",
    "ux4g-container",
    "ux4g-link",
    "ux4g-dropdown",
    "ux4g-select",
    ":where(html)",
    ":where(body)",
    ":where(*)",
    ":where(button)",
    ":where(a)",
    ":where(ul)",
    ":where(img)",
    "ux4g-display-",
)


def block(src: str, i: int) -> tuple[str, int]:
    depth = 0
    for j, c in enumerate(src[i:], i):
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return src[i : j + 1], j + 1
    return src[i:], len(src)


def extract(css: str) -> str:
    i = 0
    selected: list[str] = []
    n = len(css)
    while i < n:
        if css[i].isspace():
            i += 1
            continue
        brace = css.find("{", i)
        if brace < 0:
            break
        sel = css[i:brace]
        b, end = block(css, brace)
        blob = sel + b
        if "@font-face" in sel or ("base64," in blob and len(blob) > 20000):
            i = end
            continue
        if sel.strip().startswith(":root") or any(nd in blob for nd in NEEDLES):
            selected.append(blob)
        i = end
    return "".join(selected)


def parse_roots(css: str) -> tuple[OrderedDict[str, str], OrderedDict[str, str]]:
    light: OrderedDict[str, str] = OrderedDict()
    dark: OrderedDict[str, str] = OrderedDict()
    for m in re.finditer(r":root(?:\[data-theme=([^\]]+)\])?\{([^}]+)\}", css):
        dest = dark if m.group(1) == "dark" else light
        for part in m.group(2).split(";"):
            if ":" not in part:
                continue
            k, v = part.split(":", 1)
            k, v = k.strip(), v.strip()
            if k.startswith("--ux4g-"):
                dest[k] = v
    return light, dark


def expand_hex(h: str) -> str:
    h = h.lower()
    if len(h) == 4:
        return "#" + "".join(c * 2 for c in h[1:])
    return h


def main() -> int:
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/ux4g-vendor/ux4g.css")
    pkg = Path(__file__).resolve().parents[1]
    css = src.read_text(encoding="utf-8")
    vendor = pkg / "vendor"
    vendor.mkdir(exist_ok=True)
    header = (
        "/* Vendored subset of ux4g-web-components@3.0.0 (MIT).\n"
        " * Source: https://www.npmjs.com/package/ux4g-web-components\n"
        " * Official baseline: UX4G Design System 3.0 (ux4g.gov.in).\n"
        " * Embedded webfonts omitted; --ux4g-font-family-base still names Noto Sans.\n"
        " * Do not edit by hand; regenerate via scripts/vendor_ux4g.py.\n"
        " */\n"
    )
    (vendor / "ux4g-3.0.0-tokens-primitives.css").write_text(header + extract(css), encoding="utf-8")
    light, dark = parse_roots(css)
    hex_re = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
    catalog = {
        "baseline": {
            "name": "UX4G Design System",
            "version": "3.0",
            "package": "ux4g-web-components",
            "packageVersion": "3.0.0",
        },
        "light": dict(light),
        "dark": dict(dark),
        "hexPrimitives": {k: expand_hex(v) for k, v in light.items() if hex_re.match(v)},
        "overlayAllowlist": sorted(
            k
            for k in light
            if re.match(r"^--ux4g-color-(primary|secondary|tertiary)-\d+$", k)
        ),
    }
    (vendor / "ux4g-3.0.0-tokens.json").write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    print("wrote", vendor)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
