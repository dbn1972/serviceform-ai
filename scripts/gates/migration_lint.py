#!/usr/bin/env python3
"""Migration lint gate (db/README.md; Constitution #24; TI v1.0 s7, s8, s8.1).

Usage: migration_lint.py [paths...]   (default: db/migrations only; CR-13)

CONTRACT-REVIEW-001 CR-13: the migrator applies only db/migrations. Component-local
services/*/migrations files are refused so they cannot silently diverge from applied SQL.
"""
from __future__ import annotations

import pathlib
import re
import sys

from _common import ROOT, Report, rel

CLASSES = {"GLOBAL", "TENANT_SCOPED", "JURISDICTION_SCOPED", "CITIZEN_PRIVATE", "PLATFORM_OPERATIONAL"}
RLS_CLASSES = {"TENANT_SCOPED", "JURISDICTION_SCOPED"}
NAME = re.compile(r"^\d{13}_[a-z0-9][a-z0-9-]*\.sql$")
DECL = re.compile(r"^--\s*sf:isolation\s+(\S+)\s+(\S+)\s+owner=(CMP-0\d\d)\s*$", re.M)
UP = re.compile(r"^\s*--[\s-]*up\s+migration", re.I | re.M)
DOWN = re.compile(r"^\s*--[\s-]*down\s+migration", re.I | re.M)
CREATE_TABLE = re.compile(r"\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*|[a-z_][a-z0-9_]*)\s*\(", re.I)
FORBIDDEN = [
    (re.compile(r"\bBYPASSRLS\b", re.I), "grants BYPASSRLS (TI v1.0 s8.1)"),
    (re.compile(r"\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b", re.I), "disables row level security"),
    (re.compile(r"\bNO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY\b", re.I), "removes FORCE row level security"),
]
# SF-CON-DB-SESSION-CONTEXT: policies read the tenant through sf_platform.current_tenant_id().
# A direct current_setting('app.tenant_id', true)::uuid raises on reused pooled sessions
# (CONTRACT-REVIEW-001 CR-01). Only the migration that defines the accessor may read the setting.
RAW_TENANT_SETTING = re.compile(r"current_setting\s*\(\s*'app\.tenant_id'", re.I)
SESSION_ACCESSOR_FILES = {"1759490000000_shared-db-contracts.sql"}
DESTRUCTIVE = re.compile(r"\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE)\b", re.I)
ALLOW_DESTRUCTIVE = re.compile(r"^--\s*sf:allow-destructive\s+ADR-\d{4}\s*$")


def strip_comments(sql: str) -> str:
    """Removes -- comments and '...' string literals so only executable SQL is checked."""
    sql = re.sub(r"'(?:[^']|'')*'", "''", sql)
    return re.sub(r"--[^\n]*", "", sql)


def lint_file(path: pathlib.Path, r: Report) -> None:
    name = rel(path)
    text = path.read_text(encoding="utf-8")
    if not NAME.match(path.name):
        r.error(f"{name}: file name must be <13-digit timestamp>_<kebab-name>.sql")
    up_at, down_at = UP.search(text), DOWN.search(text)
    if not up_at or not down_at or down_at.start() < up_at.start():
        r.error(f"{name}: needs '-- Up Migration' followed by '-- Down Migration'")
        return
    up = text[up_at.end():down_at.start()]
    up_code = strip_comments(up)

    for pattern, why in FORBIDDEN:
        if pattern.search(up_code):
            r.error(f"{name}: up migration {why}")

    if path.name not in SESSION_ACCESSOR_FILES and RAW_TENANT_SETTING.search(re.sub(r"--[^\n]*", "", up)):
        r.error(f"{name}: read the tenant with sf_platform.current_tenant_id(), not current_setting('app.tenant_id') (SF-CON-DB-SESSION-CONTEXT)")

    lines = up.splitlines()
    for i, line in enumerate(lines):
        code = line.split("--", 1)[0]
        if DESTRUCTIVE.search(code):
            prev = lines[i - 1].strip() if i > 0 else ""
            if not ALLOW_DESTRUCTIVE.match(prev):
                r.error(f"{name}: destructive statement needs '-- sf:allow-destructive ADR-NNNN' above it: {code.strip()}")

    decls: dict[str, str] = {}
    for table, klass, _owner in DECL.findall(text):
        if klass not in CLASSES:
            r.error(f"{name}: {table} declares unknown isolation class {klass}")
        decls[table.lower()] = klass

    for m in CREATE_TABLE.finditer(up_code):
        table = m.group(1).lower()
        if "." not in table:
            r.error(f"{name}: table {table} must be schema-qualified (components own their schemas)")
            continue
        klass = decls.get(table)
        if not klass:
            r.error(f"{name}: {table} has no '-- sf:isolation {table} <CLASS> owner=CMP-0NN' declaration")
            continue
        if klass in RLS_CLASSES:
            body_end = up_code.find(";", m.end())
            body = up_code[m.end():body_end]
            t = re.escape(table)
            if not re.search(r"\btenant_id\s+uuid\s+NOT\s+NULL\b", body, re.I):
                r.error(f"{name}: {klass} table {table} needs 'tenant_id uuid NOT NULL'")
            if not re.search(rf"ALTER\s+TABLE\s+(?:ONLY\s+)?{t}\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY", up_code, re.I):
                r.error(f"{name}: {klass} table {table} must ENABLE ROW LEVEL SECURITY")
            if not re.search(rf"ALTER\s+TABLE\s+(?:ONLY\s+)?{t}\s+FORCE\s+ROW\s+LEVEL\s+SECURITY", up_code, re.I):
                r.error(f"{name}: {klass} table {table} must FORCE ROW LEVEL SECURITY")
            if not re.search(rf"CREATE\s+POLICY\s+\w+\s+ON\s+{t}\b", up_code, re.I):
                r.error(f"{name}: {klass} table {table} needs a CREATE POLICY")


def main(argv: list[str]) -> int:
    r = Report("migration-lint")
    if argv:
        files = [pathlib.Path(a).resolve() for a in argv]
    else:
        # CR-13 / CMP-055: authoritative scan path matches the migrator (db/migrations only).
        files = sorted((ROOT / "db/migrations").glob("*.sql"))
        misplaced = sorted(ROOT.glob("services/*/migrations/*.sql"))
        for m in misplaced:
            r.error(
                f"{rel(m)}: migrations must live under db/migrations "
                "(migrator does not apply services/*/migrations; CONTRACT-REVIEW-001 CR-13)"
            )
    for f in files:
        lint_file(f, r)
    r.note(f"{len(files)} migration file(s) checked under db/migrations (or explicit paths)")
    return r.finish()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
