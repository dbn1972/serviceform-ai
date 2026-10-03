"""Shared helpers for the architecture gates. Each gate prints findings and exits 1 on ERROR."""
from __future__ import annotations

import pathlib
import sys
from dataclasses import dataclass, field

ROOT = pathlib.Path(__file__).resolve().parents[2]


@dataclass
class Report:
    gate: str
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    info: list[str] = field(default_factory=list)

    def error(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    def note(self, msg: str) -> None:
        self.info.append(msg)

    def finish(self) -> int:
        for m in self.info:
            print(f"INFO  [{self.gate}] {m}")
        for m in self.warnings:
            print(f"WARN  [{self.gate}] {m}")
        for m in self.errors:
            print(f"ERROR [{self.gate}] {m}")
        status = "FAIL" if self.errors else "PASS"
        print(f"{status} [{self.gate}] {len(self.errors)} error(s), {len(self.warnings)} warning(s)")
        return 1 if self.errors else 0


def rel(path: pathlib.Path) -> str:
    return path.resolve().relative_to(ROOT).as_posix()


def load_yaml(path: pathlib.Path):
    try:
        import yaml
    except ImportError:
        sys.exit("PyYAML is required: pip install -r scripts/requirements.txt")
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def source_files(roots: list[str], suffixes: tuple[str, ...], exclude_parts: tuple[str, ...] = ()) -> list[pathlib.Path]:
    skip = {"node_modules", ".next", "dist", "build", "coverage", ".dart_tool", *exclude_parts}
    out: list[pathlib.Path] = []
    for r in roots:
        base = ROOT / r
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if p.is_file() and p.suffix in suffixes and not (set(p.relative_to(ROOT).parts) & skip):
                out.append(p)
    return sorted(out)
