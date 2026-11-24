#!/usr/bin/env python3
"""UX4G token and class-vocabulary gate (DESIGN-SYSTEM.md rule 3; specs/design-system.yaml
prohibited_without_adr "hard-coded design primitives where UX4G token exists").

design_system_gate.py treats packages/ui-ux4g/src/styles.css as a token file. This gate covers what
that leaves open: the ServiceForm-authored layer of that file (everything after AUTHORED_MARKER) and
the class names first-party React code puts on the page.

1. token-family: spacing, typography, radius, elevation, border/outline width, outline offset,
   z-index, opacity and motion in the authored layer use var(--ux4g-*) tokens.
2. dimension-token-exists: a width/height/inset/grid-track literal that equals a UX4G size or
   container token uses that token. Other layout literals are counted as INFO.
3. colour: no hex/rgb/hsl/named colour literal in the authored layer (fallbacks inside var() aside).
4. undefined-token: every var(--ux4g-*|--sf-*) used in the authored layer is defined.
5. undefined-class: every class in a first-party className is defined by the governed stylesheet
   (no invented UX4G vocabulary, no feature-local class names).
6. button-size: a UX4G button variant class is paired with a size class (padding/min-height).
7. inline-style: apps do not use style={...}.

A declaration may opt out with a trailing `/* ux4g-token-exempt: <reason> */` comment. Findings owned
by another workstream are listed in baselines/ux4g-known-findings.yaml (keyed by rule, path and
class_name): they report as WARN until fixed, new findings FAIL. Writes test-results/gates/ux4g-token-audit.json for evidence.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from collections import Counter
from dataclasses import asdict, dataclass

from _common import ROOT, Report, load_yaml, rel, source_files

STYLES = ROOT / "packages/ui-ux4g/src/styles.css"
AUTHORED_MARKER = "@serviceform-authored"
BASELINE = ROOT / "scripts/gates/baselines/ux4g-known-findings.yaml"
TSX_ROOTS = [
    "apps/web-citizen",
    "apps/web-officer",
    "apps/web-studio",
    "apps/web-admin",
    "packages/ui-ux4g/src",
    "packages/studio-designers/src",
]
EXEMPT = re.compile(r"/\*\s*ux4g-token-exempt:\s*\S.*?\*/")
COMMENT = re.compile(r"/\*.*?\*/", re.S)
DECL = re.compile(r"(?<![\w-])(-{0,2}[a-zA-Z][\w-]*)\s*:\s*([^;{}]+);")
LENGTH = re.compile(r"(?<![\w.#-])(-?(?:\d+\.?\d*|\.\d+))(rem|px|em|ch|vw|vh|dvh|svh)\b")
NUMBER = re.compile(r"^-?(?:\d+\.?\d*|\.\d+)$")
TIME = re.compile(r"(?<![\w.-])(\d*\.?\d+)(ms|s)\b")
COLOUR = re.compile(r"#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(")
NAMED_COLOUR = re.compile(r"(?<![\w-])(white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)(?![\w-])")
VAR_REF = re.compile(r"var\(\s*(--(?:ux4g|sf)-[\w-]+)\s*(,)?")
GENERIC_FONTS = {"monospace", "ui-monospace", "sans-serif", "serif", "system-ui", "inherit"}
BUTTON_VARIANT = re.compile(r"^ux4g-btn-(primary|danger|(outline|tonal|text)-[a-z]+)$")
BUTTON_SIZE = re.compile(r"^ux4g-btn-(xs|s|m|l|xl)$")
CLASS_TOKEN = re.compile(r"^-?[_a-zA-Z][\w-]*$")

SPACING = {"padding", "margin", "gap", "row-gap", "column-gap"}
DIMENSION = {
    "scroll-margin", "scroll-margin-top", "scroll-margin-bottom", "scroll-padding", "scroll-padding-top",
    "width", "height", "min-width", "min-height", "max-width", "max-height",
    "inline-size", "block-size", "min-inline-size", "max-inline-size", "min-block-size", "max-block-size",
    "top", "right", "bottom", "left", "inset", "inset-inline", "inset-block",
    "inset-inline-start", "inset-inline-end", "inset-block-start", "inset-block-end",
    "flex-basis", "grid-template-columns", "grid-template-rows", "grid-auto-columns", "grid-auto-rows",
    "text-underline-offset", "text-indent",
}
# property family -> token name prefixes whose values the literal must come from
FAMILIES = {
    "spacing": ("--ux4g-gap-", "--ux4g-padding-", "--ux4g-margin-", "--ux4g-space-"),
    "font-size": ("--ux4g-fs-", "--ux4g-font-size-"),
    "line-height": ("--ux4g-lh-", "--ux4g-line-height-"),
    "letter-spacing": ("--ux4g-letter-spacing-",),
    "radius": ("--ux4g-radius-",),
    "shadow": ("--ux4g-shadow-",),
    "border-width": ("--ux4g-border-width-", "--ux4g-border-"),
    "outline-width": ("--ux4g-outline-width-", "--ux4g-border-width-"),
    "outline-offset": ("--ux4g-outline-offset-",),
    "font-weight": ("--ux4g-font-weight-",),
    "z-index": ("--ux4g-z-",),
    "opacity": ("--ux4g-opacity-",),
    "duration": ("--ux4g-duration-",),
    "dimension": ("--ux4g-size-", "--ux4g-sz-", "--ux4g-container-"),
}
UNITLESS = {"font-weight", "z-index", "opacity", "duration"}


@dataclass
class Finding:
    rule: str
    path: str
    line: int
    subject: str
    detail: str
    owner: str | None = None


def family_of(prop: str) -> str | None:
    p = prop.lower()
    base = re.sub(r"-(top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end)$", "", p)
    if base in SPACING:
        return "spacing"
    if p == "font-size":
        return "font-size"
    if p == "line-height":
        return "line-height"
    if p == "letter-spacing":
        return "letter-spacing"
    if "radius" in p:
        return "radius"
    if p in {"box-shadow", "text-shadow"}:
        return "shadow"
    if p == "border" or (
        p.startswith("border-") and not any(k in p for k in ("color", "style", "collapse", "spacing", "image"))
    ):
        return "border-width"
    if p in {"outline", "outline-width"}:
        return "outline-width"
    if p == "outline-offset":
        return "outline-offset"
    if p == "font-weight":
        return "font-weight"
    if p == "z-index":
        return "z-index"
    if p in {"opacity", "fill-opacity", "stroke-opacity"}:
        return "opacity"
    if p in {"transition", "transition-duration", "animation", "animation-duration"}:
        return "duration"
    if p in DIMENSION:
        return "dimension"
    return None


def strip_vars(value: str) -> str:
    """Drops var(...) calls (and their fallbacks) so only authored literals remain."""
    out, i = [], 0
    while i < len(value):
        if value.startswith("var(", i):
            depth, j = 1, i + 4
            while j < len(value) and depth:
                depth += value[j] == "("
                depth -= value[j] == ")"
                j += 1
            out.append(" ")
            i = j
        else:
            out.append(value[i])
            i += 1
    return "".join(out)


def to_rem(num: str, unit: str) -> float | None:
    n = float(num)
    if unit == "rem":
        return round(n, 5)
    if unit == "px":
        return round(n / 16, 5)
    return None


def parse_tokens(css: str) -> dict[str, str]:
    defs: dict[str, str] = {}
    for m in re.finditer(r"(--[\w-]+)\s*:\s*([^;{}]+);", COMMENT.sub(" ", css)):
        defs.setdefault(m.group(1), m.group(2).strip())
    return defs


def resolve(name: str, defs: dict[str, str], seen: frozenset[str] = frozenset()) -> str | None:
    raw = defs.get(name)
    if raw is None or name in seen:
        return None
    m = re.fullmatch(r"var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)", raw)
    return resolve(m.group(1), defs, seen | {name}) if m else raw


def literal_index(defs: dict[str, str]) -> dict[str, dict[float | str, list[str]]]:
    """family -> normalised literal -> token names with that resolved value."""
    index: dict[str, dict[float | str, list[str]]] = {f: {} for f in FAMILIES}
    for name in defs:
        value = resolve(name, defs)
        if value is None:
            continue
        for fam, prefixes in FAMILIES.items():
            if not name.startswith(prefixes):
                continue
            key: float | str | None = None
            m = LENGTH.fullmatch(value)
            if fam in UNITLESS and (NUMBER.match(value) or TIME.fullmatch(value)):
                key = value
            elif m:
                key = to_rem(m.group(1), m.group(2)) if m.group(2) in {"rem", "px"} else value
            elif value == "0":
                key = 0.0
            if key is not None:
                index[fam].setdefault(key, []).append(name)
    return index


def suggestion(fam: str, literal: str, index) -> str:
    m = LENGTH.fullmatch(literal)
    key: float | str = to_rem(m.group(1), m.group(2)) if m and m.group(2) in {"rem", "px"} else literal
    if fam in UNITLESS:
        key = literal
    names = index.get(fam, {}).get(key, [])
    order = FAMILIES[fam]
    names = sorted(names, key=lambda n: (next(i for i, p in enumerate(order) if n.startswith(p)), n))
    return f" (use {', '.join(names[:3])})" if names else ""


def authored_layer(css: str) -> tuple[int, str]:
    pos = css.find(AUTHORED_MARKER)
    if pos < 0:
        return -1, ""
    line_start = css.rfind("\n", 0, pos) + 1
    return css.count("\n", 0, line_start) + 1, css[line_start:]


def audit_css(css: str, path: str) -> tuple[list[Finding], list[Finding], int]:
    """Returns (findings, info, exemptions) for the authored layer."""
    findings: list[Finding] = []
    info: list[Finding] = []
    first_line, layer = authored_layer(css)
    if first_line < 0:
        return [Finding("marker", path, 0, AUTHORED_MARKER, "authored-layer marker missing")], [], 0
    defs = parse_tokens(css)
    index = literal_index(defs)
    raw_lines = layer.splitlines()
    # Replace comments with spaces so offsets (and line numbers) survive.
    code = COMMENT.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), layer)
    exemptions = 0
    for m in DECL.finditer(code):
        prop, value = m.group(1), m.group(2).strip()
        line_no = first_line + code.count("\n", 0, m.start())
        end_line = first_line + code.count("\n", 0, m.end())
        src_line = raw_lines[end_line - first_line] if end_line - first_line < len(raw_lines) else ""
        if EXEMPT.search(src_line):
            exemptions += 1
            continue
        for ref in VAR_REF.finditer(value):
            if ref.group(1) not in defs:
                rule = "undefined-token"
                detail = f"{prop}: var({ref.group(1)}) is not defined by the UX4G or ServiceForm layer"
                if ref.group(2):
                    info.append(Finding(rule, path, line_no, ref.group(1), detail + " (fallback used)"))
                else:
                    findings.append(Finding(rule, path, line_no, ref.group(1), detail))
        if prop.startswith("--"):
            literal = strip_vars(value)
            if COLOUR.search(literal) or LENGTH.search(literal):
                findings.append(Finding("custom-property-literal", path, line_no, prop,
                                        f"{prop}: {value} defines an ad-hoc design value; alias a UX4G token"))
            continue
        literal = strip_vars(value)
        if COLOUR.search(literal) or (prop.endswith("color") or prop in {"color", "background", "fill", "stroke", "border", "outline"}) and NAMED_COLOUR.search(literal):
            findings.append(Finding("colour", path, line_no, value, f"{prop}: {value} hard-codes a colour; use a UX4G colour token"))
        if prop == "font-family" and "var(" not in value:
            families = {f.strip().strip("'\"") for f in value.split(",")}
            if families - GENERIC_FONTS:
                findings.append(Finding("token-family", path, line_no, value, "font-family must use --ux4g-font-family-*"))
            else:
                info.append(Finding("generic-font", path, line_no, value, "generic font stack; UX4G has no token for it"))
            continue
        fam = family_of(prop)
        if fam is None:
            continue
        if fam == "duration":
            for t in TIME.finditer(literal):
                findings.append(Finding("token-family", path, line_no, t.group(0),
                                        f"{prop}: {t.group(0)} hard-codes motion{suggestion(fam, t.group(0), index)}"))
            continue
        if fam in {"font-weight", "z-index", "opacity"}:
            if NUMBER.match(literal.strip()):
                lit = literal.strip()
                findings.append(Finding("token-family", path, line_no, lit,
                                        f"{prop}: {lit} hard-codes a {fam}{suggestion(fam, lit, index)}"))
            continue
        if fam == "line-height" and NUMBER.match(literal.strip()) and literal.strip() not in {"0", "1"}:
            findings.append(Finding("token-family", path, line_no, literal.strip(),
                                    f"{prop}: {literal.strip()} hard-codes a line height; use --ux4g-lh-*"))
            continue
        for lm in LENGTH.finditer(literal):
            lit = lm.group(0)
            if fam == "dimension":
                hint = suggestion(fam, lit.lstrip("-"), index)
                if hint and not lit.startswith("-"):
                    findings.append(Finding("dimension-token-exists", path, line_no, lit, f"{prop}: {lit}{hint}"))
                else:
                    info.append(Finding("layout-literal", path, line_no, lit, f"{prop}: {value}"))
            else:
                findings.append(Finding("token-family", path, line_no, lit,
                                        f"{prop}: {lit} hard-codes a {fam} value{suggestion(fam, lit.lstrip('-'), index)}"))
    return findings, info, exemptions


def defined_classes(css: str) -> set[str]:
    code = COMMENT.sub(" ", css)
    selectors = re.sub(r"\{[^{}]*\}", " ", code)
    return set(re.findall(r"\.(-?[_a-zA-Z][\w-]*)", selectors))


def balanced(text: str, start: int) -> str:
    depth, i = 0, start
    while i < len(text):
        depth += text[i] == "{"
        depth -= text[i] == "}"
        i += 1
        if depth == 0:
            break
    return text[start + 1 : i - 1]


def class_attrs(text: str):
    """Yields (offset, static_tokens, expression_tokens, has_dynamic_btn_size) per className."""
    for m in re.finditer(r"\bclassName\s*=\s*", text):
        i = m.end()
        if i < len(text) and text[i] in "\"'":
            q = text[i]
            j = text.find(q, i + 1)
            yield m.start(), text[i + 1 : j].split(), [], False
            continue
        if i >= len(text) or text[i] != "{":
            continue
        expr = balanced(text, i)
        static: list[str] = []
        dynamic: list[str] = []
        for t in re.finditer(r"`([^`]*)`", expr):
            body = re.sub(r"\$\{[^}]*\}", " ", t.group(1))
            static.extend(body.split())
            for inner in re.finditer(r"\$\{([^}]*)\}", t.group(1)):
                dynamic.extend(s for lit in re.findall(r"'([^']*)'|\"([^\"]*)\"", inner.group(1)) for s in " ".join(lit).split())
        rest = re.sub(r"`[^`]*`", " ", expr)
        for lit in re.findall(r"'([^']*)'|\"([^\"]*)\"", rest):
            dynamic.extend(" ".join(lit).split())
        dyn_size = bool(re.search(r"ux4g-btn-\$\{", expr))
        yield m.start(), static, dynamic, dyn_size


def audit_tsx(path_str: str, text: str, classes: set[str], is_app: bool) -> list[Finding]:
    out: list[Finding] = []
    for off, static, dynamic, dyn_size in class_attrs(text):
        line = text.count("\n", 0, off) + 1
        tokens = [t for t in static if CLASS_TOKEN.match(t) and not t.endswith("-")]
        tokens += [t for t in dynamic if CLASS_TOKEN.match(t) and t.startswith(("ux4g-", "sf-")) and not t.endswith("-")]
        for t in dict.fromkeys(tokens):
            if t not in classes:
                out.append(Finding("undefined-class", path_str, line, t,
                                   f"class '{t}' is not defined by @serviceform/ui-ux4g styles.css"))
        all_tokens = set(tokens)
        if any(BUTTON_VARIANT.match(t) for t in all_tokens) and not dyn_size and not any(BUTTON_SIZE.match(t) for t in all_tokens):
            variant = next(t for t in all_tokens if BUTTON_VARIANT.match(t))
            out.append(Finding("button-size", path_str, line, variant,
                               f"'{variant}' has no ux4g-btn-{{xs,s,m,l,xl}} size class (no padding/min-height)"))
    if is_app:
        for m in re.finditer(r"\bstyle\s*=\s*\{", text):
            out.append(Finding("inline-style", path_str, text.count("\n", 0, m.start()) + 1, "style",
                               "inline style; use a UX4G or sf-* class from @serviceform/ui-ux4g"))
    return out


def load_baseline() -> list[dict]:
    if not BASELINE.exists():
        return []
    data = load_yaml(BASELINE) or {}
    return list(data.get("findings") or [])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=str(ROOT / "test-results/gates/ux4g-token-audit.json"))
    args = ap.parse_args(argv)
    r = Report("ux4g-tokens")
    css = STYLES.read_text(encoding="utf-8")
    findings, info, exemptions = audit_css(css, rel(STYLES))
    classes = defined_classes(css)
    tsx_files = source_files(TSX_ROOTS, (".tsx",), exclude_parts=("test",))
    for f in tsx_files:
        p = rel(f)
        findings.extend(audit_tsx(p, f.read_text(encoding="utf-8"), classes, p.startswith("apps/")))

    baseline = load_baseline()
    keys = {(b["rule"], b["path"], b["class_name"]): b for b in baseline}
    used: set[tuple[str, str, str]] = set()
    for fd in findings:
        k = (fd.rule, fd.path, fd.subject)
        if k in keys:
            fd.owner = keys[k].get("owner")
            used.add(k)
            r.warn(f"{fd.path}:{fd.line}: [{fd.rule}] {fd.detail} (known finding, owner {fd.owner})")
        else:
            r.error(f"{fd.path}:{fd.line}: [{fd.rule}] {fd.detail}")
    for k in sorted(set(keys) - used):
        r.warn(f"{k[1]}: [{k[0]}] baseline entry '{k[2]}' no longer occurs; remove it from {rel(BASELINE)}")

    by_rule = Counter(fd.rule for fd in findings)
    r.note(f"authored CSS layer audited from marker '{AUTHORED_MARKER}'; {len(classes)} governed classes")
    r.note(f"{len(tsx_files)} first-party TSX files checked for class vocabulary, button sizing and inline styles")
    r.note(f"{exemptions} declaration(s) exempted with a reason; {len(info)} layout/generic literal(s) recorded as INFO")
    out = {
        "gate": "ux4g-tokens",
        "stylesheet": rel(STYLES),
        "governed_classes": len(classes),
        "tsx_files": len(tsx_files),
        "errors": len([f for f in findings if f.owner is None]),
        "known_findings": len([f for f in findings if f.owner is not None]),
        "by_rule": dict(sorted(by_rule.items())),
        "exemptions": exemptions,
        "info_literals": len(info),
        "info_by_rule": dict(sorted(Counter(i.rule for i in info).items())),
        "findings": [asdict(f) for f in findings],
        "info": [asdict(i) for i in info],
    }
    dest = pathlib.Path(args.json)
    if not dest.is_absolute():
        dest = ROOT / dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    return r.finish()


if __name__ == "__main__":
    sys.exit(main())
