"""Self-tests: each gate must catch the violation it exists for (Constitution #27: a gate that
never fails proves nothing)."""
from __future__ import annotations

import pathlib
import tempfile

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


def test_raw_tenant_setting_in_policy_fails():
    errors = lint("1700000000007_raw-tenant-setting.sql")
    assert len([e for e in errors if "sf_platform.current_tenant_id()" in e]) == 1


def test_outbox_template_passes_migration_lint():
    """SF-CON-OUTBOX: the normative template, rendered for a component, satisfies the lint."""
    root = pathlib.Path(__file__).resolve().parents[3]
    body = (root / "contracts/shared/sql/outbox.template.sql").read_text(encoding="utf-8")
    body = body.replace("{schema}", "cmp_example").replace("{cmp}", "CMP-038")
    with tempfile.TemporaryDirectory(dir=FIX) as d:  # lint reports repo-relative paths
        f = pathlib.Path(d) / "1800000000000_outbox-example.sql"
        f.write_text(f"-- Up Migration\nCREATE SCHEMA cmp_example;\n{body}\n-- Down Migration\n", encoding="utf-8")
        r = Report("t")
        migration_lint.lint_file(f, r)
    assert r.errors == []


def test_repository_migrations_pass():
    assert migration_lint.main([]) == 0


def test_migration_lint_refuses_services_migrations_directory(tmp_path, monkeypatch, capsys):
    """CR-13 / CMP-055: migrator applies db/migrations only."""
    import _common

    db = tmp_path / "db" / "migrations"
    db.mkdir(parents=True)
    good = (FIX / "1700000000001_good-tenant-table.sql").read_text(encoding="utf-8")
    (db / "1700000000001_good-tenant-table.sql").write_text(good, encoding="utf-8")
    misplaced = tmp_path / "services" / "cmp-999-example" / "migrations"
    misplaced.mkdir(parents=True)
    (misplaced / "1700000000099_misplaced.sql").write_text(good, encoding="utf-8")
    monkeypatch.setattr(_common, "ROOT", tmp_path)
    monkeypatch.setattr(migration_lint, "ROOT", tmp_path)
    assert migration_lint.main([]) == 1
    captured = capsys.readouterr().out
    assert "services/cmp-999-example/migrations/1700000000099_misplaced.sql" in captured
    assert "CR-13" in captured


def test_openapi_asyncapi_gate_passes_repo_component_contracts():
    import openapi_asyncapi_gate

    assert openapi_asyncapi_gate.main() == 0


def test_openapi_asyncapi_gate_rejects_empty_paths(tmp_path, monkeypatch):
    import _common
    import openapi_asyncapi_gate

    contracts = tmp_path / "services" / "cmp-055-developer-platform" / "contracts"
    contracts.mkdir(parents=True)
    (tmp_path / "contracts" / "shared").mkdir(parents=True)
    (contracts / "openapi.json").write_text(
        '{"openapi":"3.1.0","info":{"title":"t","version":"1"},"paths":{}}',
        encoding="utf-8",
    )
    monkeypatch.setattr(_common, "ROOT", tmp_path)
    monkeypatch.setattr(openapi_asyncapi_gate, "ROOT", tmp_path)
    assert openapi_asyncapi_gate.main() == 1


def test_workflow_pin_gate_rejects_unpinned_action(tmp_path, monkeypatch):
    import _common
    import workflow_pin_gate

    wf = tmp_path / ".github" / "workflows"
    wf.mkdir(parents=True)
    (wf / "bad.yml").write_text(
        "name: bad\non: push\njobs:\n  x:\n    runs-on: ubuntu-24.04\n    steps:\n"
        "      - uses: actions/checkout@v4\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(_common, "ROOT", tmp_path)
    monkeypatch.setattr(workflow_pin_gate, "ROOT", tmp_path)
    assert workflow_pin_gate.main() == 1


def test_workflow_pin_gate_passes_repository_workflows():
    import workflow_pin_gate

    assert workflow_pin_gate.main() == 0



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
    lockfile = check_scope.violations(env, ["pnpm-lock.yaml"])
    assert lockfile and "lockfile" in lockfile[0]


def _lockfile_env(role: str, allowed: list[str], read_only: list[str] | None = None) -> dict:
    return {
        "task_id": "SF-MXX-STITCH",
        "agent_role": role,
        "allowed_write_paths": allowed,
        "read_only_paths": read_only or ["contracts/**"],
    }


def test_scope_refuses_lockfile_for_component_builder_even_if_listed():
    env = _lockfile_env("component_builder", ["services/cmp-015-application-case/**", "pnpm-lock.yaml"])
    out = check_scope.violations(env, ["pnpm-lock.yaml"])
    assert len(out) == 1 and "lockfile" in out[0]


def test_scope_refuses_lockfile_for_integration_agent_without_exact_entry():
    for allowed in (["services/cmp-015-application-case/**"], ["**"], ["*.yaml"], ["pnpm-lock.yaml/**"]):
        out = check_scope.violations(_lockfile_env("integration_agent", allowed), ["pnpm-lock.yaml"])
        assert len(out) == 1 and "lockfile" in out[0], allowed


def test_scope_allows_root_lockfile_for_integration_agent_with_exact_entry():
    env = _lockfile_env("integration_agent", ["services/cmp-015-application-case/**", "pnpm-lock.yaml"])
    files = ["pnpm-lock.yaml", "services/cmp-015-application-case/package.json", "evidence/SF-MXX-STITCH/EVIDENCE.md"]
    assert check_scope.violations(env, files) == []
    bad = check_scope.violations(env, ["orchestrator/work-queue.yaml", "contracts/shared/x.json", "apps/api/a.ts"])
    assert len(bad) == 3


def test_scope_refuses_lockfile_for_integration_agent_when_read_only():
    for read_only in (["pnpm-lock.yaml"], ["*.yaml"]):
        env = _lockfile_env("integration_agent", ["pnpm-lock.yaml"], read_only)
        out = check_scope.violations(env, ["pnpm-lock.yaml"])
        assert len(out) == 1 and "read-only" in out[0], read_only


def test_scope_refuses_nested_lockfile_for_integration_agent():
    env = _lockfile_env("integration_agent", ["services/foo/**", "pnpm-lock.yaml", "services/foo/pnpm-lock.yaml"])
    out = check_scope.violations(env, ["services/foo/pnpm-lock.yaml"])
    assert len(out) == 1 and "nested" in out[0]


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


def test_cg01_patterns_overlap_and_serial_exception():
    import cg01_path_uniqueness_gate as g

    assert g.patterns_overlap("apps/api/src/app.ts", "apps/api/src/app.ts")
    assert not g.patterns_overlap("apps/api/src/composition/m02.ts", "apps/api/src/composition/m03.ts")
    assert not g.patterns_overlap("db/migrations/*_cmp-004-*.sql", "db/migrations/*_cmp-005-*.sql")
    assert not g.patterns_overlap("services/cmp-004-identity-access/**", "services/cmp-005-citizen-profile/**")
    hits = [("apps/api/src/app.ts", "apps/api/src/app.ts")]
    assert g.serial_overlap_allowed("SF-M02-003", "SF-M03-008", hits)
    assert not g.serial_overlap_allowed("SF-M02-001", "SF-M02-002", hits)
    bad = [("evidence/SF-M02-003/**", "evidence/SF-M03-008/**")]
    assert not g.serial_overlap_allowed("SF-M02-003", "SF-M03-008", bad)
    assert g.is_forbidden_write("pnpm-lock.yaml")
    assert g.is_forbidden_write("contracts/**")
    assert g.is_forbidden_write("orchestrator/contracts-lock.yaml")
    assert not g.is_forbidden_write("services/cmp-004-identity-access/contracts/openapi.yaml")


def test_cg01_uniqueness_gate_fails_undocumented_overlap(tmp_path, monkeypatch):
    import cg01_path_uniqueness_gate as g
    from _common import Report

    left = {
        "task_id": "SF-M02-001",
        "allowed_write_paths": ["services/cmp-004-identity-access/**"],
        "planning_only": False,
        "implementation_authorized": True,
        "state": "READY",
        "dispatched": False,
        "certified": False,
        "release_certified": False,
        "wave_eligible_now": True,
        "base_commit": {"prefix": g.BASE_PREFIX, "suffix": g.BASE_SUFFIX},
    }
    right = dict(left)
    right["task_id"] = "SF-M02-002"
    right["allowed_write_paths"] = ["services/cmp-004-identity-access/**"]
    r = Report("t")
    hits = g.overlapping_paths(left, right)
    assert hits
    for a, b in hits:
        r.error(f"write-path overlap {left['task_id']} `{a}` ∩ {right['task_id']} `{b}`")
    assert r.errors


def test_cg01_uniqueness_gate_passes_repository():
    import cg01_path_uniqueness_gate as g

    assert g.main() == 0


def test_contracts_lock_gate_catches_changed_frozen_companion(tmp_path, monkeypatch):
    import hashlib

    import _common
    import contracts_lock_gate

    (tmp_path / "orchestrator").mkdir()
    main_file, companion = tmp_path / "c.json", tmp_path / "c.sql"
    main_file.write_text("{}", encoding="utf-8")
    companion.write_text("-- v1", encoding="utf-8")
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()  # noqa: E731
    (tmp_path / "orchestrator" / "contracts-lock.yaml").write_text(
        "contracts:\n"
        f"  - {{id: X, status: FROZEN, path: c.json, schema_hash: {sha(main_file)},\n"
        f"     companions: [{{path: c.sql, sha256: {sha(companion)}}}]}}\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(_common, "ROOT", tmp_path)
    monkeypatch.setattr(contracts_lock_gate, "ROOT", tmp_path)
    assert contracts_lock_gate.main() == 0
    companion.write_text("-- v2", encoding="utf-8")
    assert contracts_lock_gate.main() == 1
