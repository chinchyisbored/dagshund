"""Tests for the debug tracing module."""

import logging
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

from dagshund import debug as debug_mod
from dagshund.debug import (
    _DEFAULT_CALL_BUDGET,
    _format_call,
    _format_location,
    _format_name,
    _format_return,
    _format_unwind,
    _on_return,
    _on_start,
    _on_unwind,
    _poison,
    _should_trace,
    _summarize_params,
    _summarize_value,
    disable_profile_tracing,
    enable_profile_tracing,
)

# --- _summarize_value ---


def test_summarize_value_short_string() -> None:
    assert _summarize_value("hello") == "str(5) 'hello'"


def test_summarize_value_long_string_shows_char_count() -> None:
    result = _summarize_value("a" * 100)
    assert result == f"str(100) '{'a' * 20}'..."


def test_summarize_value_string_at_boundary() -> None:
    assert _summarize_value("a" * 20) == f"str(20) '{'a' * 20}'"
    assert _summarize_value("a" * 21) == f"str(21) '{'a' * 20}'..."


def test_summarize_value_dict_shows_key_count() -> None:
    assert _summarize_value({"a": 1, "b": 2}) == "dict(2 keys)"


def test_summarize_value_empty_dict() -> None:
    assert _summarize_value({}) == "dict(0 keys)"


def test_summarize_value_bool() -> None:
    assert _summarize_value(True) == "True"
    assert _summarize_value(False) == "False"


def test_summarize_value_none() -> None:
    assert _summarize_value(None) == "None"


def test_summarize_value_int_uses_repr() -> None:
    assert _summarize_value(42) == "42"


def test_summarize_value_list_shows_item_count() -> None:
    assert _summarize_value([1, 2]) == "list(2 items)"


def test_summarize_value_tuple_shows_item_count() -> None:
    assert _summarize_value((1, 2, 3)) == "tuple(3 items)"


def test_summarize_value_broken_repr_falls_back() -> None:
    class Broken:
        def __repr__(self) -> str:
            raise RuntimeError("broken")

    assert _summarize_value(Broken()) == "<Broken repr-failed>"


# --- _should_trace ---


@pytest.fixture
def populated_files() -> Iterator[None]:
    """Snapshot _DAGSHUND_FILES the way enable_profile_tracing would."""
    root = Path(debug_mod.__file__).parent.resolve()
    self_path = str(Path(debug_mod.__file__).resolve())
    original = debug_mod._DAGSHUND_FILES
    debug_mod._DAGSHUND_FILES = frozenset(str(p) for p in root.rglob("*.py") if str(p) != self_path)
    try:
        yield
    finally:
        debug_mod._DAGSHUND_FILES = original


def test_should_trace_dagshund_function(populated_files: None) -> None:
    from dagshund.model import parse_plan

    assert _should_trace(parse_plan.__code__)


def test_should_trace_excludes_debug_module(populated_files: None) -> None:
    assert not _should_trace(_summarize_value.__code__)


def test_should_trace_excludes_stdlib(populated_files: None) -> None:
    fake = compile("pass", "/usr/lib/python3.14/json/__init__.py", "exec")
    assert not _should_trace(fake)


def test_should_trace_excludes_dunder_names(populated_files: None) -> None:
    from dagshund.model import parse_plan

    src = "def __init__(self):\n    pass\n"
    mod = compile(src, parse_plan.__code__.co_filename, "exec")
    init_code = next(c for c in mod.co_consts if isinstance(c, type(mod)) and c.co_name == "__init__")
    assert not _should_trace(init_code)


def test_should_trace_excludes_module_code(populated_files: None) -> None:
    from dagshund.model import parse_plan

    mod = compile("x = 1", parse_plan.__code__.co_filename, "exec")
    # Module-level code has co_name == '<module>'
    assert mod.co_name.startswith("<")
    assert not _should_trace(mod)


# --- _summarize_params ---


def test_summarize_params_positional() -> None:
    captured: list[object] = []

    def fn(x: int, y: str) -> None:
        captured.append(sys._getframe())

    fn(1, "hello")
    frame = captured[0]
    assert isinstance(frame, type(sys._getframe()))
    assert _summarize_params(frame) == "x=1, y=str(5) 'hello'"


def test_summarize_params_zero_args() -> None:
    captured: list[object] = []

    def fn() -> None:
        captured.append(sys._getframe())

    fn()
    frame = captured[0]
    assert isinstance(frame, type(sys._getframe()))
    assert _summarize_params(frame) == ""


def test_summarize_params_keyword_only() -> None:
    captured: list[object] = []

    def fn(x: int, *, y: str) -> None:
        captured.append(sys._getframe())

    fn(1, y="hi")
    frame = captured[0]
    assert isinstance(frame, type(sys._getframe()))
    assert _summarize_params(frame) == "x=1, y=str(2) 'hi'"


def test_summarize_params_excludes_varargs() -> None:
    captured: list[object] = []

    def fn(x: int, *args: int, **kwargs: int) -> None:
        captured.append(sys._getframe())

    fn(1, 2, 3, key=4)
    frame = captured[0]
    assert isinstance(frame, type(sys._getframe()))
    # *args / **kwargs are excluded from the summary.
    assert _summarize_params(frame) == "x=1"


# --- _format_name / _format_location / _format_call / _format_return / _format_unwind ---


def test_format_name_regular_function() -> None:
    def regular() -> int:
        return 1

    assert _format_name(regular.__code__) == "regular"


def test_format_name_generator_marker() -> None:
    def gen() -> Iterator[int]:
        yield 1

    assert _format_name(gen.__code__) == "gen (gen)"


def test_format_location_uses_basename() -> None:
    def fn() -> None: ...

    loc = _format_location(fn.__code__, 42)
    assert loc.endswith(":42")
    # basename only, no directories.
    assert "/" not in loc


def test_format_call_depth_zero() -> None:
    assert _format_call("foo", "x=1", 0, "model.py:10") == "→ foo(x=1) [model.py:10]"


def test_format_call_depth_three_has_six_spaces() -> None:
    assert _format_call("foo", "", 3, "model.py:10") == "      → foo() [model.py:10]"


def test_format_return_no_indent_and_ms_rounding() -> None:
    assert _format_return("foo", 42, 0, 12.345) == "← foo → 42 (12.3ms)"


def test_format_return_sub_millisecond_rounds_to_zero() -> None:
    assert _format_return("foo", None, 0, 0.04) == "← foo → None (0.0ms)"


def test_format_return_at_depth() -> None:
    assert _format_return("foo", None, 2, 1.0) == "    ← foo → None (1.0ms)"


def test_format_unwind_includes_type_and_message() -> None:
    exc = ValueError("missing key")
    expected = "✗ foo raised ValueError: missing key (1.2ms) [model.py:10]"
    assert _format_unwind("foo", exc, 0, 1.2, "model.py:10") == expected


def test_format_unwind_at_depth() -> None:
    exc = RuntimeError("nope")
    assert _format_unwind("bar", exc, 2, 0.5, "m.py:1") == "    ✗ bar raised RuntimeError: nope (0.5ms) [m.py:1]"


# --- callback unit tests (called directly — no sys.monitoring dispatch) ---


@pytest.fixture
def callback_ready(
    populated_files: None,
    caplog: pytest.LogCaptureFixture,
) -> Iterator[pytest.LogCaptureFixture]:
    """Reset mutable module state so callbacks can be called directly in tests."""
    caplog.set_level(logging.DEBUG, logger="dagshund")
    debug_mod._POISONED = False
    debug_mod._call_budget = _DEFAULT_CALL_BUDGET
    debug_mod._stack.clear()
    yield caplog
    debug_mod._POISONED = False
    debug_mod._call_budget = _DEFAULT_CALL_BUDGET
    debug_mod._stack.clear()


def test_on_start_emits_call_and_pushes_stack(callback_ready: pytest.LogCaptureFixture) -> None:
    from dagshund.model import parse_plan

    result = _on_start(parse_plan.__code__, 0)
    assert result is None
    assert len(debug_mod._stack) == 1
    msgs = _messages(callback_ready)
    assert any(m.startswith("→ parse_plan(") and "[model.py:" in m for m in msgs)


def test_on_start_filters_non_dagshund_with_disable(callback_ready: pytest.LogCaptureFixture) -> None:
    fake = compile("pass", "/usr/lib/python3.14/json/__init__.py", "exec")
    result = _on_start(fake, 0)
    assert result is sys.monitoring.DISABLE
    assert len(debug_mod._stack) == 0
    assert _messages(callback_ready) == []


def test_on_start_poisoned_returns_none(callback_ready: pytest.LogCaptureFixture) -> None:
    from dagshund.model import parse_plan

    debug_mod._POISONED = True
    result = _on_start(parse_plan.__code__, 0)
    assert result is None
    assert len(debug_mod._stack) == 0


def test_on_start_debug_disabled_returns_disable(callback_ready: pytest.LogCaptureFixture) -> None:
    from dagshund.model import parse_plan

    callback_ready.set_level(logging.WARNING, logger="dagshund")
    result = _on_start(parse_plan.__code__, 0)
    assert result is sys.monitoring.DISABLE


def test_on_start_budget_exhausted_truncates(callback_ready: pytest.LogCaptureFixture) -> None:
    from dagshund.model import parse_plan

    debug_mod._call_budget = 0
    result = _on_start(parse_plan.__code__, 0)
    assert result is None
    assert debug_mod._POISONED is True
    msgs = _messages(callback_ready)
    assert any("trace truncated" in m for m in msgs)


def test_on_start_recovers_from_exception_via_poison(
    callback_ready: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from dagshund.model import parse_plan

    def boom(*_a: object, **_kw: object) -> str:
        raise OSError("injected")

    monkeypatch.setattr(debug_mod, "_summarize_params", boom)
    result = _on_start(parse_plan.__code__, 0)
    assert result is None
    assert debug_mod._POISONED is True


def test_on_return_emits_and_pops(callback_ready: pytest.LogCaptureFixture) -> None:
    from dagshund.model import parse_plan

    _on_start(parse_plan.__code__, 0)
    callback_ready.clear()
    result = _on_return(parse_plan.__code__, 0, "result_value")
    assert result is None
    assert len(debug_mod._stack) == 0
    msgs = _messages(callback_ready)
    assert any(m.startswith("← parse_plan → ") and "'result_value'" in m for m in msgs)


def test_on_return_empty_stack_no_emit(callback_ready: pytest.LogCaptureFixture) -> None:
    from dagshund.model import parse_plan

    assert len(debug_mod._stack) == 0
    result = _on_return(parse_plan.__code__, 0, None)
    assert result is None
    assert _messages(callback_ready) == []


def test_on_return_poisoned_returns_none(callback_ready: pytest.LogCaptureFixture) -> None:
    from dagshund.model import parse_plan

    debug_mod._POISONED = True
    result = _on_return(parse_plan.__code__, 0, None)
    assert result is None


def test_on_return_debug_disabled_returns_disable(callback_ready: pytest.LogCaptureFixture) -> None:
    from dagshund.model import parse_plan

    callback_ready.set_level(logging.WARNING, logger="dagshund")
    result = _on_return(parse_plan.__code__, 0, None)
    assert result is sys.monitoring.DISABLE


def test_on_return_filters_non_dagshund_with_disable(callback_ready: pytest.LogCaptureFixture) -> None:
    fake = compile("pass", "/usr/lib/python3.14/json/__init__.py", "exec")
    result = _on_return(fake, 0, None)
    assert result is sys.monitoring.DISABLE


def test_on_unwind_emits_with_location_and_pops(callback_ready: pytest.LogCaptureFixture) -> None:
    from dagshund.model import parse_plan

    _on_start(parse_plan.__code__, 0)
    callback_ready.clear()
    exc = ValueError("field missing")
    _on_unwind(parse_plan.__code__, 0, exc)
    assert len(debug_mod._stack) == 0
    msgs = _messages(callback_ready)
    unwind = next(m for m in msgs if m.startswith("✗ parse_plan raised ValueError:"))
    assert "field missing" in unwind
    assert "[model.py:" in unwind


def test_on_unwind_empty_stack_no_emit(callback_ready: pytest.LogCaptureFixture) -> None:
    from dagshund.model import parse_plan

    _on_unwind(parse_plan.__code__, 0, ValueError("x"))
    assert _messages(callback_ready) == []


def test_on_unwind_poisoned_no_emit(callback_ready: pytest.LogCaptureFixture) -> None:
    from dagshund.model import parse_plan

    debug_mod._POISONED = True
    _on_unwind(parse_plan.__code__, 0, ValueError("x"))
    assert _messages(callback_ready) == []


def test_on_unwind_debug_disabled_no_emit(callback_ready: pytest.LogCaptureFixture) -> None:
    from dagshund.model import parse_plan

    callback_ready.set_level(logging.WARNING, logger="dagshund")
    _on_unwind(parse_plan.__code__, 0, ValueError("x"))
    assert _messages(callback_ready) == []


def test_on_unwind_filters_non_dagshund(callback_ready: pytest.LogCaptureFixture) -> None:
    fake = compile("pass", "/usr/lib/python3.14/json/__init__.py", "exec")
    _on_unwind(fake, 0, ValueError("x"))
    assert _messages(callback_ready) == []


def test_on_unwind_never_returns_disable(callback_ready: pytest.LogCaptureFixture) -> None:
    """PY_UNWIND is a global event — DISABLE would raise ValueError in user code."""
    from dagshund.model import parse_plan

    fake = compile("pass", "/usr/lib/python3.14/json/__init__.py", "exec")
    for result in (
        _on_unwind(fake, 0, ValueError("x")),
        _on_unwind(parse_plan.__code__, 0, ValueError("x")),  # empty stack
    ):
        assert result is None
        assert result is not sys.monitoring.DISABLE


def test_on_unwind_recovers_from_exception_via_poison(
    callback_ready: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from dagshund.model import parse_plan

    _on_start(parse_plan.__code__, 0)
    callback_ready.clear()

    def boom(*_a: object, **_kw: object) -> str:
        raise OSError("injected")

    monkeypatch.setattr(debug_mod, "_format_location", boom)
    _on_unwind(parse_plan.__code__, 0, ValueError("x"))
    assert debug_mod._POISONED is True


def test_poison_sets_flag_and_logs(
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    caplog.set_level(logging.DEBUG, logger="dagshund")
    debug_mod._POISONED = False
    try:
        try:
            raise RuntimeError("synthetic")
        except RuntimeError:
            _poison()
        assert debug_mod._POISONED is True
    finally:
        debug_mod._POISONED = False


# --- integration ---


@pytest.fixture
def profile_tracing(caplog: pytest.LogCaptureFixture) -> Iterator[pytest.LogCaptureFixture]:
    caplog.set_level(logging.DEBUG, logger="dagshund")
    enable_profile_tracing()
    try:
        yield caplog
    finally:
        disable_profile_tracing()


def _messages(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.name == "dagshund"]


def test_integration_preamble_on_enable(caplog: pytest.LogCaptureFixture) -> None:
    # Enable inside the test (not via fixture) so the preamble record lands in
    # the test-phase capture buffer rather than the setup-phase buffer.
    caplog.set_level(logging.DEBUG, logger="dagshund")
    enable_profile_tracing()
    try:
        msgs = _messages(caplog)
        assert any(m.startswith("# dagshund ") and "python" in m for m in msgs)
    finally:
        disable_profile_tracing()


def test_integration_nested_calls_indented(profile_tracing: pytest.LogCaptureFixture) -> None:
    from dagshund import parse_plan

    parse_plan('{"plan": {}, "plan_version": 1}')
    msgs = _messages(profile_tracing)
    # Top-level call has no indent.
    assert any(m.startswith("→ parse_plan(") for m in msgs)
    # Nested call is indented two spaces (depth 1).
    assert any(m.startswith("  → parse_plan_data(") for m in msgs)


def test_integration_exception_emits_unwind_line(profile_tracing: pytest.LogCaptureFixture) -> None:
    from dagshund import DagshundError, parse_plan

    with pytest.raises(DagshundError):
        parse_plan("not json")
    msgs = _messages(profile_tracing)
    assert any(m.startswith("✗ parse_plan raised DagshundError:") for m in msgs)
    # No normal-return line for the failed call.
    assert not any(m.startswith("← parse_plan →") for m in msgs)


def test_integration_unwind_includes_location(profile_tracing: pytest.LogCaptureFixture) -> None:
    from dagshund import DagshundError, parse_plan

    with pytest.raises(DagshundError):
        parse_plan("not json")
    msgs = _messages(profile_tracing)
    unwind = next(m for m in msgs if m.startswith("✗ parse_plan raised"))
    assert "[model.py:" in unwind


def test_integration_caught_exception_no_false_unwind(profile_tracing: pytest.LogCaptureFixture) -> None:
    from dagshund import parse_plan

    parse_plan('{"plan": {}}')
    msgs = _messages(profile_tracing)
    assert not any(m.startswith("✗") or (" ✗ " in m) for m in msgs)


def test_integration_generator_path_balanced(
    profile_tracing: pytest.LogCaptureFixture,
    real_plan_json: str,
) -> None:
    from dagshund import parse_plan
    from dagshund.markdown import render_markdown

    plan = parse_plan(real_plan_json)
    render_markdown(plan)
    msgs = _messages(profile_tracing)

    def glyph(m: str) -> str:
        stripped = m.lstrip()
        return stripped[:1]

    starts = sum(1 for m in msgs if glyph(m) == "→")
    returns = sum(1 for m in msgs if glyph(m) == "←")
    unwinds = sum(1 for m in msgs if glyph(m) == "✗")
    assert starts == returns + unwinds, f"imbalance: starts={starts}, returns={returns}, unwinds={unwinds}"
    assert any("(gen)" in m for m in msgs), "expected at least one generator marker"


def test_integration_enable_disable_cycle_idempotent(caplog: pytest.LogCaptureFixture) -> None:
    from dagshund import parse_plan

    caplog.set_level(logging.DEBUG, logger="dagshund")
    for _ in range(3):
        enable_profile_tracing()
        try:
            caplog.clear()
            parse_plan('{"plan": {}}')
            msgs = [r.getMessage() for r in caplog.records if r.name == "dagshund"]
            assert any(m.startswith("→ parse_plan(") for m in msgs)
        finally:
            disable_profile_tracing()


def test_integration_double_enable_warns(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG, logger="dagshund")
    enable_profile_tracing()
    try:
        caplog.clear()
        enable_profile_tracing()
        msgs = [r.getMessage() for r in caplog.records if r.name == "dagshund"]
        assert any("already enabled" in m for m in msgs)
    finally:
        disable_profile_tracing()


def test_integration_disable_when_not_registered_is_noop() -> None:
    # Should not raise.
    disable_profile_tracing()
    disable_profile_tracing()


def test_integration_tool_id_already_claimed_warns(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG, logger="dagshund")
    sys.monitoring.use_tool_id(sys.monitoring.PROFILER_ID, "external")
    try:
        enable_profile_tracing()
        msgs = [r.getMessage() for r in caplog.records if r.name == "dagshund"]
        assert any("profiler tool id already in use" in m for m in msgs)
        assert debug_mod._registered is False
    finally:
        sys.monitoring.free_tool_id(sys.monitoring.PROFILER_ID)


def test_integration_poison_flag_stops_further_emits(
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from dagshund import parse_plan

    caplog.set_level(logging.DEBUG, logger="dagshund")
    enable_profile_tracing()
    try:

        def boom(*_a: object, **_kw: object) -> str:
            raise OSError("injected")

        monkeypatch.setattr(debug_mod, "_summarize_params", boom)
        # This call triggers the first on_start, which calls _summarize_params → OSError → poison.
        parse_plan('{"plan": {}}')
        assert debug_mod._POISONED is True

        caplog.clear()
        # Subsequent call should emit nothing (poisoned).
        parse_plan('{"plan": {}}')
        msgs = [r.getMessage() for r in caplog.records if r.name == "dagshund"]
        tracer_lines = [m for m in msgs if m.startswith(("→", "←", "✗", "  "))]
        assert tracer_lines == []
    finally:
        disable_profile_tracing()


def test_integration_call_budget_truncates(
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from dagshund import parse_plan

    caplog.set_level(logging.DEBUG, logger="dagshund")
    enable_profile_tracing()
    try:
        monkeypatch.setattr(debug_mod, "_call_budget", 2)
        caplog.clear()
        parse_plan('{"plan": {}, "plan_version": 1}')
        msgs = [r.getMessage() for r in caplog.records if r.name == "dagshund"]
        assert any("trace truncated" in m for m in msgs)
        assert debug_mod._POISONED is True
    finally:
        disable_profile_tracing()
