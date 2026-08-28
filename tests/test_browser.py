from pathlib import Path

import pytest
from factories import plan_from_dict

from dagshund.browser import (
    PLACEHOLDER,
    PROVENANCE_PLACEHOLDER,
    _escape_for_script_tag,
    _inject_plan,
    _load_template,
    render_browser,
)
from dagshund.provenance import HtmlProvenance
from dagshund.types import DagshundError

# --- _load_template ---


def test_load_template_returns_html_string(require_template: None) -> None:
    result = _load_template()

    assert isinstance(result, str)
    lowered = result.lower()
    assert "<!doctype" in lowered or "<html" in lowered


def test_load_template_raises_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    import dagshund.browser as browser_mod

    class _FakeResource:
        def is_file(self) -> bool:
            return False

    class _FakePackage:
        def joinpath(self, _name: str) -> _FakeResource:
            return _FakeResource()

    monkeypatch.setattr(browser_mod, "files", lambda _pkg: _FakePackage())
    with pytest.raises(DagshundError, match=r"template\.html not found"):
        _load_template()


# --- _escape_for_script_tag ---


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ("", ""),
        ("<script>", "\\u003cscript>"),
        ("<a><b>", "\\u003ca>\\u003cb>"),
        ("hello world", "hello world"),
        ("</script>", "\\u003c/script>"),
    ],
    ids=["empty_string", "single_bracket", "multiple_brackets", "no_brackets", "closing_script"],
)
def test_escape_for_script_tag(content: str, expected: str) -> None:
    assert _escape_for_script_tag(content) == expected


# --- _inject_plan ---


def test_inject_plan_replaces_placeholder() -> None:
    template = f"<html>{PLACEHOLDER}</html>"

    result = _inject_plan(template, plan_from_dict({"key": "value"}))

    assert PLACEHOLDER not in result
    assert "key" in result
    assert "value" in result


def test_inject_plan_missing_placeholder_raises() -> None:
    with pytest.raises(DagshundError, match="not found"):
        _inject_plan("<html>no placeholder</html>", plan_from_dict({"key": "value"}))


def test_inject_plan_duplicate_placeholder_raises() -> None:
    template = f"<script>{PLACEHOLDER}</script><!-- {PLACEHOLDER} -->"
    with pytest.raises(DagshundError, match="found 2"):
        _inject_plan(template, plan_from_dict({"key": "value"}))


def test_inject_plan_escapes_angle_brackets_in_values() -> None:
    """Injected JSON must not contain raw < inside the script block."""
    template = f"<script>{PLACEHOLDER}</script>"

    result = _inject_plan(template, plan_from_dict({"html": "<script>alert(1)</script>"}))

    injected_part = result.replace("<script>", "").replace("</script>", "")
    assert "<" not in injected_part


def test_inject_plan_uses_compact_json() -> None:
    template = f"<div>{PLACEHOLDER}</div>"

    result = _inject_plan(template, plan_from_dict({"a": 1, "b": 2}))

    injected = result.removeprefix("<div>").removesuffix("</div>")
    assert '" :' not in injected
    assert '", ' not in injected


def test_inject_plan_excludes_uc_secret_values() -> None:
    template = f"<script>{PLACEHOLDER}</script>"
    plan = plan_from_dict(
        {
            "plan": {
                "resources.secrets.api_token": {
                    "action": "create",
                    "new_state": {
                        "effective_value": "plaintext-effective-secret",
                        "value": {"name": "api_token", "value": "plaintext-secret"},
                    },
                }
            }
        }
    )

    result = _inject_plan(template, plan)

    assert "plaintext-secret" not in result
    assert "plaintext-effective-secret" not in result
    assert "[redacted]" in result


@pytest.mark.parametrize(
    "malformed_state",
    ["UC_SECRET_SENTINEL", 42, True, ["UC_SECRET_SENTINEL"]],
    ids=["string", "number", "boolean", "array"],
)
def test_inject_plan_excludes_malformed_uc_secret_state(malformed_state: object) -> None:
    template = f"<script>{PLACEHOLDER}</script>"
    plan = plan_from_dict(
        {
            "plan": {
                "resources.secrets.api_token": {
                    "action": "create",
                    "new_state": malformed_state,
                }
            }
        }
    )

    result = _inject_plan(template, plan)

    assert "UC_SECRET_SENTINEL" not in result
    assert "[redacted]" in result


def test_inject_plan_keeps_secret_scopes_unchanged() -> None:
    template = f"<script>{PLACEHOLDER}</script>"
    plan = plan_from_dict(
        {
            "plan": {
                "resources.secret_scopes.legacy": {
                    "action": "create",
                    "new_state": {"value": {"name": "legacy", "value": "scope-value"}},
                }
            }
        }
    )

    result = _inject_plan(template, plan)

    assert "scope-value" in result


def test_inject_plan_placeholder_string_in_plan_data() -> None:
    """Plan data containing the placeholder string should not break injection."""
    template = f"before:{PLACEHOLDER}:after"

    result = _inject_plan(template, plan_from_dict({"key": PLACEHOLDER}))

    assert result.startswith("before:")
    assert result.endswith(":after")
    injected = result.removeprefix("before:").removesuffix(":after")
    assert f'"key":"{PLACEHOLDER}"' in injected


def test_inject_plan_replaces_provenance_with_compact_json() -> None:
    template = f"{PLACEHOLDER}|{PROVENANCE_PLACEHOLDER}"
    provenance = HtmlProvenance("plan.json", "2026-08-27T12:00:00Z", "a" * 64, "0.15.0", "1.14.0")

    result = _inject_plan(template, plan_from_dict({"plan": {}}), provenance)

    assert result == (
        '{"plan":{}}|{"source_name":"plan.json","source_modified_at":"2026-08-27T12:00:00Z",'
        '"source_plan_sha256":"' + "a" * 64 + '","dagshund_version":"0.15.0","plan_cli_version":"1.14.0"}'
    )


def test_inject_plan_validates_duplicate_provenance_placeholder() -> None:
    template = f"{PLACEHOLDER}{PROVENANCE_PLACEHOLDER}{PROVENANCE_PLACEHOLDER}"
    provenance = HtmlProvenance("plan.json", None, "a" * 64, "0.15.0", None)

    with pytest.raises(DagshundError, match="found 2"):
        _inject_plan(template, plan_from_dict({"plan": {}}), provenance)


def test_inject_plan_keeps_placeholder_like_values_literal() -> None:
    template = f"{PLACEHOLDER}|{PROVENANCE_PLACEHOLDER}"
    provenance = HtmlProvenance(PLACEHOLDER, None, "a" * 64, PROVENANCE_PLACEHOLDER, None)

    result = _inject_plan(template, plan_from_dict({"value": PROVENANCE_PLACEHOLDER}), provenance)

    assert f'"value":"{PROVENANCE_PLACEHOLDER}"' in result
    assert f'"source_name":"{PLACEHOLDER}"' in result
    assert f'"dagshund_version":"{PROVENANCE_PLACEHOLDER}"' in result


def test_inject_plan_escapes_provenance_script_content() -> None:
    template = f"<script>{PLACEHOLDER}|{PROVENANCE_PLACEHOLDER}</script>"
    provenance = HtmlProvenance("</script>", None, "a" * 64, "0.15.0", None)

    result = _inject_plan(template, plan_from_dict({"plan": {}}), provenance)

    assert '</script>"' not in result
    assert "\\u003c/script>" in result


# --- render_browser (integration) ---


def test_render_browser_writes_html_file(require_template: None, tmp_path: Path) -> None:
    output = tmp_path / "output.html"

    render_browser(plan_from_dict({"plan": {}}), output_path=str(output))

    assert output.exists()
    content = output.read_text()
    assert "<!doctype html>" in content.lower() or "<html" in content.lower()


def test_render_browser_prints_success_message(
    require_template: None, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    output = tmp_path / "output.html"

    render_browser(plan_from_dict({"plan": {}}), output_path=str(output))

    assert "exported to" in capsys.readouterr().err


def test_render_browser_overwrites_existing_file(require_template: None, tmp_path: Path) -> None:
    output = tmp_path / "output.html"
    output.write_text("old content")

    render_browser(plan_from_dict({"plan": {}}), output_path=str(output))

    assert "old content" not in output.read_text()


def test_render_browser_rejects_symlink_output(require_template: None, tmp_path: Path) -> None:
    target = tmp_path / "real.html"
    target.write_text("real file")
    link = tmp_path / "link.html"
    link.symlink_to(target)

    with pytest.raises(DagshundError, match="symlink"):
        render_browser(plan_from_dict({"plan": {}}), output_path=str(link))


def test_render_browser_write_error_raises(require_template: None, tmp_path: Path) -> None:
    bad_path = tmp_path / "nonexistent" / "deep" / "output.html"

    with pytest.raises(DagshundError, match="could not write output file"):
        render_browser(plan_from_dict({"plan": {}}), output_path=str(bad_path))
