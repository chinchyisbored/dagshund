"""Profile-based debug tracing for all dagshund function calls."""

import logging
import sys
import time
from types import FrameType

logger = logging.getLogger("dagshund")


def _summarize_value(value: object) -> str:
    """Create a concise summary of a value for debug logging."""
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
            return repr(value)


def enable_profile_tracing() -> None:
    """Enable sys.setprofile-based tracing for all dagshund functions."""
    call_stack: list[float] = []

    def profile_hook(frame: FrameType, event: str, arg: object) -> None:
        """Profile callback that traces all dagshund function calls."""
        module: str | None = frame.f_globals.get("__name__")
        if module is None or not module.startswith("dagshund") or module == "dagshund.debug":
            return

        fn_name = frame.f_code.co_name
        if fn_name.startswith("__") or fn_name.startswith("<"):
            return

        if event == "call":
            code = frame.f_code
            # co_varnames stores parameter names first, then locals
            n_params = code.co_argcount + code.co_kwonlyargcount
            param_names = code.co_varnames[:n_params]
            locals_ = frame.f_locals
            arg_summary = ", ".join(f"{name}={_summarize_value(locals_.get(name))}" for name in param_names)
            logger.debug("→ %s(%s)", fn_name, arg_summary)
            call_stack.append(time.perf_counter())

        elif event == "return":
            elapsed_ms = 0.0
            if call_stack:
                elapsed_ms = (time.perf_counter() - call_stack.pop()) * 1000
            logger.debug("← %s → %s (%.1fms)", fn_name, _summarize_value(arg), elapsed_ms)

    sys.setprofile(profile_hook)
