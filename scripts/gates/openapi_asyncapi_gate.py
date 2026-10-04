#!/usr/bin/env python3
"""Lint component-local OpenAPI/AsyncAPI contracts (Eng v1.4 CMP-055).

Scans services/*/contracts/openapi.* and asyncapi.* only. Never mutates or
re-validates contracts/shared (frozen; contracts_lock_gate owns that plane).
"""
from __future__ import annotations

import json
import pathlib
import sys

from _common import ROOT, Report, load_yaml, rel

OPENAPI_NAMES = ("openapi.json", "openapi.yaml", "openapi.yml")
ASYNCAPI_NAMES = ("asyncapi.json", "asyncapi.yaml", "asyncapi.yml")


def load_doc(path: pathlib.Path):
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError("empty document")
    if text[0] in "{[":
        return json.loads(text)
    return load_yaml(path)


def lint_openapi(doc: object, name: str, r: Report) -> None:
    if not isinstance(doc, dict):
        r.error(f"{name}: OpenAPI root must be an object")
        return
    version = doc.get("openapi")
    if not isinstance(version, str) or not version.startswith("3."):
        r.error(f"{name}: openapi must be a 3.x version string")
    info = doc.get("info")
    if not isinstance(info, dict) or not info.get("title") or not info.get("version"):
        r.error(f"{name}: info.title and info.version are required")
    paths = doc.get("paths")
    if not isinstance(paths, dict) or not paths:
        r.error(f"{name}: paths must be a non-empty object")


def lint_asyncapi(doc: object, name: str, r: Report) -> None:
    if not isinstance(doc, dict):
        r.error(f"{name}: AsyncAPI root must be an object")
        return
    version = doc.get("asyncapi")
    if not isinstance(version, str) or not (version.startswith("2.") or version.startswith("3.")):
        r.error(f"{name}: asyncapi must be a 2.x or 3.x version string")
    info = doc.get("info")
    if not isinstance(info, dict) or not info.get("title") or not info.get("version"):
        r.error(f"{name}: info.title and info.version are required")
    channels = doc.get("channels")
    operations = doc.get("operations")
    has_channels = isinstance(channels, dict) and bool(channels)
    has_operations = isinstance(operations, dict) and bool(operations)
    if not has_channels and not has_operations:
        r.error(f"{name}: channels or operations must be a non-empty object")


def iter_component_contracts() -> list[pathlib.Path]:
    out: list[pathlib.Path] = []
    services = ROOT / "services"
    if not services.is_dir():
        return out
    for cmp_dir in sorted(services.iterdir()):
        contracts = cmp_dir / "contracts"
        if not contracts.is_dir():
            continue
        for name in (*OPENAPI_NAMES, *ASYNCAPI_NAMES):
            p = contracts / name
            if p.is_file():
                out.append(p)
    return out


def main() -> int:
    r = Report("openapi-asyncapi")
    shared = ROOT / "contracts" / "shared"
    if not shared.is_dir():
        r.error("contracts/shared missing; refusing to run without frozen shared plane")
        return r.finish()

    files = iter_component_contracts()
    for path in files:
        name = rel(path)
        if "contracts/shared" in name:
            r.error(f"{name}: component gate must not target frozen shared contracts")
            continue
        try:
            doc = load_doc(path)
        except Exception as exc:  # noqa: BLE001 — surface parse failures as gate errors
            r.error(f"{name}: parse failed: {exc}")
            continue
        base = path.name.lower()
        if base.startswith("openapi"):
            lint_openapi(doc, name, r)
        elif base.startswith("asyncapi"):
            lint_asyncapi(doc, name, r)
    r.note(f"{len(files)} component OpenAPI/AsyncAPI file(s) checked; shared contracts untouched")
    return r.finish()


if __name__ == "__main__":
    sys.exit(main())
