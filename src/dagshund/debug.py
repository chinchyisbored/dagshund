"""Function-call tracer for the ``-d`` / ``DAGSHUND_DEBUG`` flag.

Built on ``sys.monitoring`` (PEP 669). Emits one line per ``PY_START`` /
``PY_RETURN`` / ``PY_UNWIND`` event for dagshund frames, indented by call
depth, to the ``dagshund`` logger at DEBUG. The unwind channel is what
makes bug-report logs useful: a crash renders as ``✗ fn raised Exc: ...``
instead of being indistinguishable from a normal ``return None``.
"""

import atexit
import inspect
import logging
import sys
import time
from contextlib import suppress
from pathlib import Path
from types import CodeType, FrameType

logger = logging.getLogger("dagshund")

_TOOL_ID = sys.monitoring.PROFILER_ID
_TOOL_NAME = "dagshund"
_DEFAULT_CALL_BUDGET = 100_000

_DAGSHUND_FILES: frozenset[str] = frozenset()
_POISONED: bool = False
_call_budget: int = _DEFAULT_CALL_BUDGET
_stack: list[float] = []
_registered: bool = False


def _summarize_value(value: object) -> str:
    match value:
        case str():
            if len(value) <= 20:
                return f"str({len(value)}) {value!r}"
            return f"str({len(value)}) {value[:20]!r}..."
        case dict():
            return f"dict({len(value)} keys)"
        case bool():
            return str(value)
        case list():
            return f"list({len(value)} items)"
        case tuple():
            return f"tuple({len(value)} items)"
        case None:
            return "None"
        case _:
            try:
                r = repr(value)
            except BaseException:
                return f"<{type(value).__name__} repr-failed>"
            if len(r) > 120:
                return f"{r[:120]}..."
            return r


def _should_trace(code: CodeType) -> bool:
    if code.co_filename not in _DAGSHUND_FILES:
        return False
    name = code.co_name
    return not name.startswith(("__", "<"))


def _summarize_params(frame: FrameType) -> str:
    code = frame.f_code
    n_params = code.co_argcount + code.co_kwonlyargcount
    param_names = code.co_varnames[:n_params]
    locals_ = frame.f_locals
    return ", ".join(f"{name}={_summarize_value(locals_.get(name))}" for name in param_names)


def _format_name(code: CodeType) -> str:
    if code.co_flags & inspect.CO_GENERATOR:
        return f"{code.co_name} (gen)"
    return code.co_name


def _format_location(code: CodeType, lineno: int) -> str:
    return f"{Path(code.co_filename).name}:{lineno}"


def _format_call(fn_name: str, params: str, depth: int, location: str) -> str:
    return f"{'  ' * depth}→ {fn_name}({params}) [{location}]"


def _format_return(fn_name: str, retval: object, depth: int, elapsed_ms: float) -> str:
    return f"{'  ' * depth}← {fn_name} → {_summarize_value(retval)} ({elapsed_ms:.1f}ms)"


def _format_unwind(fn_name: str, exc: BaseException, depth: int, elapsed_ms: float, location: str) -> str:
    return f"{'  ' * depth}✗ {fn_name} raised {type(exc).__name__}: {exc} ({elapsed_ms:.1f}ms) [{location}]"


def _emit_preamble() -> None:
    from dagshund import __version__

    py = sys.version_info
    logger.debug(
        "# dagshund %s, python %d.%d.%d (%s)",
        __version__,
        py.major,
        py.minor,
        py.micro,
        sys.platform,
    )


def _poison() -> None:
    global _POISONED
    _POISONED = True
    with suppress(BaseException):
        logger.exception("dagshund.debug: trace hook failed — tracer disabled")


def _on_start(code: CodeType, _ip: int) -> object:
    global _call_budget, _POISONED
    if _POISONED:
        return None
    if not logger.isEnabledFor(logging.DEBUG):
        return sys.monitoring.DISABLE
    try:
        if not _should_trace(code):
            return sys.monitoring.DISABLE
        if _call_budget <= 0:
            _POISONED = True
            with suppress(BaseException):
                logger.debug("# trace truncated: call budget exhausted")
            with suppress(BaseException):
                sys.monitoring.set_events(_TOOL_ID, 0)
            return None
        _call_budget -= 1
        # frame 0 = _on_start; frame 1 = traced frame. Registered without a
        # dispatcher layer — any wrapper added later must bump this index.
        frame = sys._getframe(1)
        params = _summarize_params(frame)
        depth = len(_stack)
        location = _format_location(code, code.co_firstlineno)
        logger.debug("%s", _format_call(_format_name(code), params, depth, location))
        _stack.append(time.perf_counter())
        return None
    except (KeyboardInterrupt, SystemExit):
        raise
    except BaseException:
        _poison()
        return None


def _on_return(code: CodeType, _ip: int, retval: object) -> object:
    if _POISONED:
        return None
    if not logger.isEnabledFor(logging.DEBUG):
        return sys.monitoring.DISABLE
    try:
        if not _should_trace(code):
            return sys.monitoring.DISABLE
        if not _stack:
            return None
        start = _stack.pop()
        elapsed_ms = (time.perf_counter() - start) * 1000
        depth = len(_stack)
        logger.debug("%s", _format_return(_format_name(code), retval, depth, elapsed_ms))
        return None
    except (KeyboardInterrupt, SystemExit):
        raise
    except BaseException:
        _poison()
        return None


def _on_unwind(code: CodeType, _ip: int, exception: BaseException) -> None:
    # PY_UNWIND is a global event — returning DISABLE would raise ValueError
    # in user code (per sys.monitoring docs).
    if _POISONED:
        return
    if not logger.isEnabledFor(logging.DEBUG):
        return
    try:
        if not _should_trace(code):
            return
        if not _stack:
            return
        start = _stack.pop()
        elapsed_ms = (time.perf_counter() - start) * 1000
        depth = len(_stack)
        # frame 1 = unwinding frame; f_lineno is the line that raised/propagated.
        location = _format_location(code, sys._getframe(1).f_lineno)
        logger.debug("%s", _format_unwind(_format_name(code), exception, depth, elapsed_ms, location))
    except (KeyboardInterrupt, SystemExit):
        raise
    except BaseException:
        _poison()


def enable_profile_tracing() -> None:
    global _DAGSHUND_FILES, _POISONED, _call_budget, _registered
    if _registered:
        logger.warning("dagshund.debug: tracing already enabled; call disable_profile_tracing first")
        return
    try:
        try:
            sys.monitoring.use_tool_id(_TOOL_ID, _TOOL_NAME)
        except ValueError:
            logger.warning("dagshund.debug: profiler tool id already in use; tracing not enabled")
            return
        _registered = True

        root = Path(__file__).parent.resolve()
        self_path = str(Path(__file__).resolve())
        _DAGSHUND_FILES = frozenset(str(p) for p in root.rglob("*.py") if str(p) != self_path)
        _POISONED = False
        _call_budget = _DEFAULT_CALL_BUDGET
        _stack.clear()

        events = sys.monitoring.events
        sys.monitoring.register_callback(_TOOL_ID, events.PY_START, _on_start)
        sys.monitoring.register_callback(_TOOL_ID, events.PY_RETURN, _on_return)
        sys.monitoring.register_callback(_TOOL_ID, events.PY_UNWIND, _on_unwind)
        sys.monitoring.restart_events()
        sys.monitoring.set_events(_TOOL_ID, events.PY_START | events.PY_RETURN | events.PY_UNWIND)
        atexit.register(disable_profile_tracing)
        _emit_preamble()
    except (KeyboardInterrupt, SystemExit):
        disable_profile_tracing()
        raise
    except BaseException:
        disable_profile_tracing()
        with suppress(BaseException):
            logger.warning("dagshund.debug: failed to enable tracing; continuing without trace")


def disable_profile_tracing() -> None:
    global _registered
    if not _registered:
        return
    events = sys.monitoring.events
    with suppress(BaseException):
        sys.monitoring.set_events(_TOOL_ID, 0)
    for ev in (events.PY_START, events.PY_RETURN, events.PY_UNWIND):
        with suppress(BaseException):
            sys.monitoring.register_callback(_TOOL_ID, ev, None)
    with suppress(BaseException):
        sys.monitoring.restart_events()
    with suppress(BaseException):
        sys.monitoring.free_tool_id(_TOOL_ID)
    with suppress(BaseException):
        atexit.unregister(disable_profile_tracing)
    _stack.clear()
    _registered = False
