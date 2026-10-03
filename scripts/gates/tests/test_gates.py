"""Self-tests: each gate must catch the violation it exists for (Constitution #27: a gate that
never fails proves nothing)."""
from __future__ import annotations

import pathlib

import check_scope
import migration_lint
import validate_specs
from _common import Report

FIX = pathlib.Path(__file__).parent / "fixtures" / "migrations"


def lint(name: str) -> list[str]:
    r = Report("t")
    migration_lint.lint_file(FIX / name, r)
    return r.errors


def test_good_tenant_table_passes():
    assert lint("1700000000001_good-tenant-table.sql") == []


def test_tenant_table_without_force_rls_and_policy_fails():
    errors = lint("1700000000002_tenant-table-without-rls.sql")
    assert any("FORCE ROW LEVEL SECURITY" in e for e in errors)
    assert any("CREATE POLICY" in e for e in errors)


def test_undeclared_table_fails():
    assert any("has no '-- sf:isolation" in e for e in lint("1700000000003_undeclared-table.sql"))


def test_bypassrls_no_force_and_unapproved_drop_fail():
    errors = lint("1700000000004_bypass-and-drop.sql")
    assert any("BYPASSRLS" in e for e in errors)
    assert any("removes FORCE" in e for e in errors)
    assert any("destructive statement" in e for e in errors)


def test_missing_down_section_fails():
    assert any("Down Migration" in e for e in lint("1700000000005_no-down.sql"))


def test_bad_file_name_fails():
    assert any("file name" in e for e in lint("bad_name.sql"))


def test_nullable_tenant_id_fails():
    assert any("tenant_id uuid NOT NULL" in e for e in lint("1700000000006_nullable-tenant.sql"))


def test_repository_migrations_pass():
    assert migration_lint.main([]) == 0


def test_scope_allows_envelope_paths_and_refuses_others():
    env = {
        "task_id": "SF-M01-001",
        "allowed_write_paths": ["services/cmp-002-tenant-organisation/**"],
        "read_only_paths": ["contracts/**", "ARCHITECTURE-CONSTITUTION.md"],
    }
    ok = ["services/cmp-002-tenant-organisation/src/a.ts", "evidence/SF-M01-001/run.md", "orchestrator/handovers/SF-M01-001.yaml"]
    assert check_scope.violations(env, ok) == []
    bad = check_scope.violations(env, ["contracts/shared/x.json", "orchestrator/work-queue.yaml", "services/cmp-003-jurisdiction/a.ts"])
    assert len(bad) == 3


def test_plan_validator_flags_duplicate_and_missing_owners(tmp_path, monkeypatch):
    plan = tmp_path / "plan.yaml"
    plan.write_text(
        "modules:\n"
        "- {id: M00, name: a, depends_on: [], exit_gate: G1_BUILD_READY}\n"
        "- {id: M01, name: b, depends_on: [M00], exit_gate: G4_SECURITY_VERIFIED, components: [CMP-001, CMP-001], integrations: [INT-001]}\n"
        "- {id: M02, name: c, depends_on: [M09]}\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(validate_specs, "ROOT", tmp_path)
    r = Report("t")
    findings = validate_specs.plan_findings("plan.yaml", r)
    assert "CMP-001 owned by 2 modules: M01, M01" in findings
    assert "CMP-002 has no owning module" in findings
    assert "M02 has no exit_gate" in findings
    assert any("unknown module M09" in e for e in r.errors)


def test_plan_validator_detects_cycles(tmp_path, monkeypatch):
    plan = tmp_path / "plan.yaml"
    plan.write_text(
        "modules:\n"
        "- {id: M00, name: a, depends_on: []}\n"
        "- {id: M01, name: b, depends_on: [M02]}\n"
        "- {id: M02, name: c, depends_on: [M01]}\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(validate_specs, "ROOT", tmp_path)
    r = Report("t")
    validate_specs.plan_findings("plan.yaml", r)
    assert any("dependency cycle" in e for e in r.errors)


def test_design_system_gate_rejects_parallel_design_system(tmp_path, monkeypatch):
    import design_system_gate

    app = tmp_path / "apps" / "web-x"
    (app / "app").mkdir(parents=True)
    (tmp_path / "package.json").write_text("{}", encoding="utf-8")
    (app / "package.json").write_text('{"dependencies": {"@mui/material": "7.0.0"}}', encoding="utf-8")
    (app / "app" / "page.tsx").write_text("export const x = { color: '#ff0000' };\n", encoding="utf-8")
    (app / "app" / "local.css").write_text("a { color: red }\n", encoding="utf-8")
    monkeypatch.setattr(design_system_gate, "ROOT", tmp_path)
    import _common

    monkeypatch.setattr(_common, "ROOT", tmp_path)
    assert design_system_gate.main() == 1


def test_jurisdiction_gate_rejects_state_name_in_source(tmp_path, monkeypatch):
    import _common
    import hardcoding_gate

    src = tmp_path / "services" / "cmp-008-rules" / "src"
    src.mkdir(parents=True)
    (src / "rule.ts").write_text("if (state === 'Tamil Nadu') { fee = 0; }\n", encoding="utf-8")
    tests = tmp_path / "services" / "cmp-008-rules" / "test"
    tests.mkdir()
    (tests / "rule.test.ts").write_text("const fixture = 'Kerala';\n", encoding="utf-8")
    monkeypatch.setattr(_common, "ROOT", tmp_path)
    monkeypatch.setattr(hardcoding_gate, "ROOT", tmp_path)
    assert hardcoding_gate.main() == 1


def test_jurisdiction_gate_ignores_tests(tmp_path, monkeypatch):
    import _common
    import hardcoding_gate

    tests = tmp_path / "services" / "cmp-008-rules" / "test"
    tests.mkdir(parents=True)
    (tests / "rule.test.ts").write_text("const fixture = 'Kerala';\n", encoding="utf-8")
    monkeypatch.setattr(_common, "ROOT", tmp_path)
    monkeypatch.setattr(hardcoding_gate, "ROOT", tmp_path)
    assert hardcoding_gate.main() == 0
