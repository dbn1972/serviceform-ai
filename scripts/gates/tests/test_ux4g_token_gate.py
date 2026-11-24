"""Self-tests for ux4g_token_gate.py: each rule must fail on the violation it exists for."""
from __future__ import annotations

import json

import ux4g_token_gate as g

TOKENS = """:root {
  --ux4g-gap-4: 0.5rem;
  --ux4g-radius-3: 0.5rem;
  --ux4g-radius-md: var(--ux4g-radius-3);
  --ux4g-size-48: 3rem;
  --ux4g-z-1: 1;
  --ux4g-opacity-60: 0.6;
  --ux4g-duration-fast: 0.2s;
  --ux4g-text-neutral-primary: #171717;
}
.ux4g-btn-primary { color: var(--ux4g-text-neutral-primary); }
.ux4g-btn-m { min-height: 2.5rem; }
.ux4g-text-link-m { color: inherit; }
"""
MARK = "/* @serviceform-authored: test layer */\n"


def css_findings(layer: str) -> list[g.Finding]:
    findings, _info, _ex = g.audit_css(TOKENS + MARK + layer, "styles.css")
    return findings


def rules(findings: list[g.Finding]) -> list[str]:
    return [f.rule for f in findings]


def test_tokenised_authored_layer_passes():
    layer = (
        ".sf-a {\n  gap: var(--ux4g-gap-4);\n  border-radius: var(--ux4g-radius-md);\n"
        "  width: var(--ux4g-size-48);\n  z-index: var(--ux4g-z-1);\n"
        "  transition: color var(--ux4g-duration-fast) ease;\n  grid-template-columns: minmax(0, 1fr) 21rem;\n}\n"
    )
    assert css_findings(layer) == []


def test_vendored_layer_is_not_audited():
    findings, _info, _ex = g.audit_css(".x { padding: 13px; color: #123456; }\n" + MARK, "styles.css")
    assert findings == []


def test_raw_token_family_values_fail_with_a_suggestion():
    layer = (
        ".sf-a {\n  padding: 0.5rem;\n  border-radius: 8px;\n  z-index: 1;\n  opacity: 0.6;\n"
        "  font-weight: 600;\n  transition: opacity 0.2s ease;\n  line-height: 1.5;\n}\n"
    )
    found = css_findings(layer)
    assert rules(found).count("token-family") == 7
    by_subject = {f.subject: f.detail for f in found}
    assert "--ux4g-gap-4" in by_subject["0.5rem"]
    assert "--ux4g-radius-3" in by_subject["8px"]
    assert "--ux4g-duration-fast" in by_subject["0.2s"]


def test_dimension_literal_with_an_equal_token_fails_but_layout_literal_is_info():
    findings, info, _ex = g.audit_css(TOKENS + MARK + ".sf-a {\n  width: 3rem;\n  max-width: 68rem;\n}\n", "s.css")
    assert [(f.rule, f.subject) for f in findings] == [("dimension-token-exists", "3rem")]
    assert [i.rule for i in info] == ["layout-literal"]


def test_colour_literal_fails_but_var_fallback_does_not():
    found = css_findings(".sf-a {\n  color: #fff;\n  background: var(--ux4g-text-neutral-primary, #000);\n}\n")
    assert rules(found) == ["colour"]


def test_undefined_token_and_ad_hoc_custom_property_fail():
    found = css_findings(".sf-a {\n  gap: var(--ux4g-gap-44);\n  --sf-local: 1.25rem;\n}\n")
    assert sorted(rules(found)) == ["custom-property-literal", "undefined-token"]


def test_exempt_comment_requires_a_reason():
    ok = ".sf-a {\n  margin: -1px; /* ux4g-token-exempt: visually-hidden clip pattern */\n}\n"
    assert css_findings(ok) == []
    bare = ".sf-a {\n  margin: -1px; /* ux4g-token-exempt: */\n}\n"
    assert rules(css_findings(bare)) == ["token-family"]


def test_missing_marker_fails():
    findings, _info, _ex = g.audit_css(TOKENS, "styles.css")
    assert rules(findings) == ["marker"]


def test_class_vocabulary_button_size_and_inline_style():
    classes = g.defined_classes(TOKENS)
    tsx = (
        'export const A = () => <a className="ux4g-link">x</a>;\n'
        'export const B = () => <button className="ux4g-btn-primary">x</button>;\n'
        'export const C = () => <button className="ux4g-btn-primary ux4g-btn-m">x</button>;\n'
        "export const D = ({ s }) => <button className={`ux4g-btn-primary ux4g-btn-${s}`}>x</button>;\n"
        "export const E = ({ e }) => <p className={e ? 'ux4g-text-link-m' : 'sf-nope'} style={{ margin: 0 }} />;\n"
    )
    found = g.audit_tsx("apps/web-x/a.tsx", tsx, classes, is_app=True)
    assert [(f.rule, f.subject, f.line) for f in found] == [
        ("undefined-class", "ux4g-link", 1),
        ("button-size", "ux4g-btn-primary", 2),
        ("undefined-class", "sf-nope", 5),
        ("inline-style", "style", 5),
    ]
    assert g.audit_tsx("packages/ui-ux4g/src/a.tsx", "<p style={{}} />", classes, is_app=False) == []


def test_baseline_downgrades_known_findings_and_new_ones_fail(tmp_path, monkeypatch):
    import _common

    styles = tmp_path / "packages/ui-ux4g/src/styles.css"
    styles.parent.mkdir(parents=True)
    styles.write_text(TOKENS + MARK + ".sf-a { gap: var(--ux4g-gap-4); }\n", encoding="utf-8")
    comp = tmp_path / "apps/web-citizen/components"
    comp.mkdir(parents=True)
    (comp / "Desk.tsx").write_text('export const A = () => <a className="ux4g-link">x</a>;\n', encoding="utf-8")
    baseline = tmp_path / "baseline.yaml"
    baseline.write_text(
        "findings:\n  - {rule: undefined-class, path: apps/web-citizen/components/Desk.tsx, class_name: ux4g-link, owner: ws1}\n",
        encoding="utf-8",
    )
    for mod in (_common, g):
        monkeypatch.setattr(mod, "ROOT", tmp_path)
    monkeypatch.setattr(g, "STYLES", styles)
    monkeypatch.setattr(g, "BASELINE", baseline)
    out = tmp_path / "audit.json"
    assert g.main(["--json", str(out)]) == 0
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["errors"] == 0 and report["known_findings"] == 1

    (comp / "Desk.tsx").write_text(
        'export const A = () => <a className="ux4g-link">x</a>;\nexport const B = () => <i className="sf-new" />;\n',
        encoding="utf-8",
    )
    assert g.main(["--json", str(out)]) == 1
