# Python Guidelines

## Basics
- **Target**: 3.12+ — no `from __future__ import annotations`
- **Files**: `snake_case.py`
- **Naming**: `snake_case` functions, `PascalCase` types, `SCREAMING_SNAKE_CASE` constants
- **Visibility**: prefix module-internal functions with `_`. Public API functions (exported or called from other modules) have no prefix.

## Data & Types
- **Data carriers**: frozen dataclasses (`@dataclass(frozen=True, slots=True)`). Computed `@property` methods on frozen dataclasses are acceptable for derived fields — keep them pure and O(1). If the computation is non-trivial, use a function to signal cost to callers.
- **Type aliases**: use `type` statement syntax (`type ResourceKey = str`). Not `TypeAlias` annotation or bare assignment.
- **`Any`**: minimize. Use `object` when the value is truly unknown. Use `Any` only at JSON/external data boundaries where full structural typing is impractical. Use `TypeGuard` functions to narrow `Any` at usage points.
- **Generators**: annotate with `Iterator[T]` return type, not `Generator`. Use generators when the caller does not need random access to all results at once.

## Functional Patterns
- Comprehensions and generator expressions over explicit loops
- `itertools` (`groupby`, `chain`) and `collections` (`Counter`, `defaultdict`) when they match the operation naturally
- `any()`/`all()` for boolean reduction
- Prefer comprehensions or explicit accumulation over `functools.reduce`
- Structural pattern matching (`match`/`case`) for type dispatch and destructuring — prefer over `isinstance` chains or `if`/`elif` ladders

## Error Handling
- Raise domain-specific exceptions (`DagshundError`) at failure points
- Catch at the boundary (CLI entry point)
- Never silently swallow exceptions
- Chain exceptions with `from` to preserve tracebacks

## Imports & Performance
- Lazy imports for optional features (debug tracing, browser output, webbrowser) to keep CLI startup fast
- Standard imports at the top of the file for everything else

## Testing
- See [TESTING.md](TESTING.md). `test_<function>_<scenario>_<expected>` naming, AAA, parametrize, monkeypatch over mocks.
