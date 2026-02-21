# Testing Guidelines

## Philosophy

### Test Isolation
Tests must be completely independent. Never rely on execution order — each test sets up its own state and cleans up after itself. If Test B fails when Test A doesn't run first, both tests are broken.

### Arrange-Act-Assert (AAA)
Structure tests with clear visual separation between setup, execution, and verification. Use blank lines between the phases. Comments are optional — use them for complex tests, skip them for simple ones.

### What NOT to Test
- **Framework code** — don't test pytest, Bun, Zod, or React Flow. They're already tested.
- **Trivial getters/setters** — if it's just returning a field, don't write a test for it.
- **Unreachable error paths** — if validation at layer A prevents invalid data from ever reaching layer B, skip testing layer B's error path. That's defense-in-depth, not a test gap.

### Test Happy and Sad Paths
Every function with failure modes should have tests for both success and failure.

---

## Python

### Running Tests

```bash
just test          # JS + Python tests
just check         # lint + typecheck + all tests
uv run pytest -v   # Python only, verbose
uv run pytest -k "parse_plan"  # Run tests matching expression
```

The `-k` expression is a pytest keyword filter, NOT a file path.

### Structure

**Standalone functions, no classes.** Use standalone `test_` functions. Do not use test classes.

```python
# Good
def test_parse_plan_invalid_json_raises() -> None:
    ...

# Avoid
class TestParsePlan:
    def test_invalid_json_raises(self) -> None:
        ...
```

### File Layout

Mirror the source directory. One test file per source file:

```
src/dagshund/        tests/
  cli.py        →     test_cli.py
  browser.py    →     test_browser.py
  text.py       →     test_text.py
  __main__.py   →     (covered in test_cli.py)
```

### Naming

`test_<function>_<scenario>_<expected_outcome>`

```python
def test_read_plan_permission_denied_raises(tmp_path: Path) -> None: ...
def test_supports_color_force_color_zero_falls_through(monkeypatch: pytest.MonkeyPatch) -> None: ...
def test_render_resource_update_shows_field_changes() -> None: ...
```

### Type Annotations

All test functions get `-> None`. All fixture parameters get their types:

```python
def test_example(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    ...
```

### Parametrize for Multiple Scenarios

When testing a function across many inputs, use `@pytest.mark.parametrize`. Use frozen dataclasses for complex cases:

```python
@dataclass(frozen=True)
class ActionMappingCase:
    name: str
    action: str
    expected_color: str
    expected_symbol: str

ACTION_MAPPING_CASES = [
    ActionMappingCase("create", "create", GREEN, "+"),
    ActionMappingCase("delete", "delete", RED, "-"),
    ...
]

@pytest.mark.parametrize("case", ACTION_MAPPING_CASES, ids=lambda c: c.name)
def test_action_color(case: ActionMappingCase) -> None:
    assert _action_color(case.action) == case.expected_color
```

Skip parametrize if assertion logic becomes deeply nested or tests wildly different behaviors — write separate focused functions instead.

### Docstrings

**Well-named test functions don't need docstrings.** Only add them when:
- Complex setup needs explanation
- Non-obvious assertions need context
- Parametrized tests need scenario descriptions
- Edge cases need the *why*

```python
# Good — name says it all, no docstring needed
def test_escape_for_script_tag_replaces_all_occurrences() -> None:
    ...

# Good — explains why this matters
def test_inject_plan_escapes_angle_brackets_in_values() -> None:
    """Injected JSON must not contain raw < inside the script block."""
    ...

# Bad — just restates the name
def test_parse_plan() -> None:
    """Test parse_plan function."""  # Delete this
    ...
```

### Mocking

**Prefer `monkeypatch`** — it auto-cleans up after each test:

```python
def test_supports_color_isatty_true(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NO_COLOR", raising=False)
    monkeypatch.setattr(sys.stdout, "isatty", lambda: True)
    assert _supports_color() is True
```

Only use `unittest.mock.patch` when monkeypatch can't do the job (e.g., method chains). Always comment why.

### Assertions

**No redundant assertion messages.** Pytest already shows expected vs actual:

```python
# Good
assert result == expected

# Bad — noise
assert result == expected, f"Expected {expected}, got {result}"
```

Add messages only for parametrized tests (to identify which case failed) or multi-step assertions where context isn't obvious.

### Side Effect Cleanup

Use `try/finally` when monkeypatch can't handle it:

```python
def test_find_template_raises_when_missing(tmp_path: Path) -> None:
    import dagshund.browser as browser_mod
    original = browser_mod.__file__
    try:
        browser_mod.__file__ = str(tmp_path / "browser.py")
        with pytest.raises(DagshundError, match=r"template\.html not found"):
            _find_template()
    finally:
        browser_mod.__file__ = original
```

### Fixtures (pytest)

Use built-in fixtures (`tmp_path`, `capsys`, `monkeypatch`). JSON test data lives in `js/test-bundle/` (shared with JS). Reference with:

```python
FIXTURES_DIR = Path(__file__).parent.parent / "js" / "test-bundle"
```

---

## TypeScript (Bun)

### Running Tests

```bash
just test-js       # Run all JS tests
bun test --cwd js  # Same thing, directly
```

### Structure

**`describe` blocks group related tests. `test` blocks (not `it`) define individual cases.**

```typescript
describe("buildPlanGraph", () => {
    test("returns empty graph for empty plan", () => {
        const graph = buildPlanGraph(emptyPlan);
        expect(graph.nodes).toHaveLength(0);
    });
});
```

Nesting is fine for sub-grouping, but keep it shallow (max 2 levels).

### File Layout

Mirror the source directory. Files use `kebab-case.test.ts`:

```
js/src/               js/tests/
  parser/        →      parser/
    parse-plan.ts  →      parse-plan.test.ts
  graph/         →      graph/
    build-plan-graph.ts → build-plan-graph.test.ts
  utils/         →      utils/
    diff-state-styles.ts → diff-state-styles.test.ts
```

### Naming

Test descriptions should be plain English, lowercase, describe behavior:

```typescript
test("extracts all tasks from etl_pipeline", async () => { ... });
test("returns error for missing plan_version", () => { ... });
test("every DiffState returns all four style properties", () => { ... });
```

### Assertions

Use `expect()` from `bun:test`:

```typescript
expect(result).toBe(value);           // strict equality
expect(result).toEqual(value);        // deep equality
expect(array).toHaveLength(3);
expect(object).toHaveProperty("key");
expect(string).toContain("substring");
expect(result.ok).toBe(true);
```

### Result Types

Functions that can fail return `Result<T, E>`. Tests must handle both branches:

```typescript
const result = parsePlanJson(input);
expect(result.ok).toBe(true);
if (result.ok) {
    expect(result.data.plan_version).toBe(2);
}
```

For error cases, check the error message (Zod v4 uses **lowercase**):

```typescript
expect(result.ok).toBe(false);
if (!result.ok) {
    expect(result.error).toContain("expected number");
}
```

### Fixtures

Load via the shared helper:

```typescript
import { loadFixture } from "../helpers/load-fixture.ts";

test("parses complex plan", async () => {
    const plan = await loadFixture("complex-plan.json");
    expect(plan.plan_version).toBe(2);
});
```

Fixtures live in `js/tests/fixtures/` and are shared with Python tests.

### Mocking

**Prefer passing test data directly over mocking.** The codebase is built on pure functions — pass input, assert output. No mocking libraries needed for most tests.

For iteration-based parametrization, use `for...of` inside a test:

```typescript
test("every DiffState returns all four style properties", () => {
    const states: readonly DiffState[] = ["added", "removed", "modified", "unchanged"];
    for (const state of states) {
        const styles = getDiffStateStyles(state);
        expect(styles).toHaveProperty("border");
    }
});
```

### Non-null Assertions

When test data guarantees an element exists, use `!` with a biome-ignore comment:

```typescript
// biome-ignore lint/style/noNonNullAssertion: test array has exactly one element
const state = extractTaskState(tasks[0]!);
```
