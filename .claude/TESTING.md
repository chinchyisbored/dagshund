# Testing Guidelines

## Philosophy

- **Isolation** — tests are completely independent. Never rely on execution order.
- **AAA** — Arrange-Act-Assert with blank lines between phases. Comments optional.
- **Happy and sad paths** — every function with failure modes gets both.
- **Don't test frameworks** — no testing pytest, Bun, Zod, or React Flow themselves.
- **Don't test the unreachable** — if layer A validates, skip layer B's error path.

---

## Python

### Running Tests

```bash
just test          # All tests (JS + Python)
just test-py       # Python only
just test-py "filter"  # -k expression or file::test (NOT a file path)
just check         # lint + typecheck + all tests
```

### Conventions

- **Standalone functions, no classes.** `test_` functions only.
- **File layout**: mirror source — `cli.py` → `test_cli.py`, `browser.py` → `test_browser.py`
- **Naming**: `test_<function>_<scenario>_<expected_outcome>`
- **Type annotations**: `-> None` on all tests, typed fixture params (`monkeypatch: pytest.MonkeyPatch`, `tmp_path: Path`, `capsys: pytest.CaptureFixture[str]`)
- **Parametrize**: `@pytest.mark.parametrize` with frozen dataclass cases and `ids=lambda c: c.name`. Skip if assertion logic diverges — write separate functions.
- **Docstrings**: well-named test functions don't need docstrings. Only add them for complex setup, non-obvious assertions, or edge case rationale. Never restate the name.
- **Mocking**: `monkeypatch` over `unittest.mock.patch`. Use mock only for method chains, with a comment explaining why.
- **Assertions**: no redundant messages — pytest shows expected vs actual. Add messages only for parametrized or multi-step assertions.
- **Side effects**: `try/finally` when monkeypatch can't handle cleanup (e.g., reassigning `__file__`).
- **Fixtures**: built-in (`tmp_path`, `capsys`, `monkeypatch`). JSON test data in `fixtures/` at repo root (shared with JS). Reference: `FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"`

---

## TypeScript (Bun)

### Running Tests

```bash
just test-js             # All JS tests
just test-js "filter"    # Name pattern filter
```

### Conventions

- **Structure**: `describe` blocks group related tests, `test` blocks (not `it`) define cases. Max 2 levels of nesting.
- **File layout**: mirror source with `kebab-case.test.ts`
- **Naming**: plain English, lowercase, describe behavior
- **Result types**: test both `ok` and error branches. Narrow with `if (result.ok)` / `if (!result.ok)` before asserting. Zod v4 errors are **lowercase**.
- **Fixtures**: `loadFixture("complex-plan.json")` from `../helpers/load-fixture.ts`. Shared with Python in `fixtures/`.
- **Mocking**: prefer passing test data to pure functions over mocking. Use `for...of` inside a test for iteration-based parametrization.
- **Non-null assertions**: `!` with `// biome-ignore lint/style/noNonNullAssertion:` comment explaining why.
