# Testing Guidelines

## Philosophy

- **Isolation** — tests are completely independent. Never rely on execution order.
- **AAA** — Arrange-Act-Assert with blank lines between phases. Comments optional if neccesary.
- **Happy and sad paths** — every function with failure modes gets both.
- **Don't test frameworks** — no testing pytest, Bun, Zod, or React Flow themselves.

## Regression contracts

- Define observable acceptance before changing code. For bugs, reproduce the failure through the relevant CLI, renderer, graph consumer, or interaction before fixing it. Prefer public behavior over private call counts or implementation structure.
- Cover relevant failure, boundary, and forbidden cases alongside success. Assert outputs, exit codes, state transitions, redaction, and absence of prohibited side effects as appropriate.
- Each regression assertion must distinguish the broken behavior from the correct behavior. Do not derive expected results from the same implementation under test, weaken assertions to make checks pass, or treat a coverage percentage as proof of correctness.
- Adapt tests to production boundaries; do not change production APIs only to make testing easier.

### Async behavior and isolation

- Exercise relevant out-of-order success and failure, replacement, cancellation, and cleanup cases. Control completion with deferred promises, events, or supported fake timers; await the actual condition instead of sleeping or relying on scheduling luck.
- Assert product behavior, not framework no-ops. An unchanged hook result after unmount alone does not prove that application cancellation worked, because React can discard unmounted state updates.
- Keep files, environment, mocks, timers, and listeners isolated and restore them after each test. Do not depend on another test's setup or leave pending work that can affect later tests.

### External boundaries and evidence

- Use real pure transformations and fixture data where possible. Stub external commands, network, browser launch, or other effects at the boundary being isolated, not the behavior under test. For forbidden actions, assert that the boundary was never called.
- Ordinary checks must not contact live services or perform deployments. Live fixture regeneration and expectation updates require separate user approval; follow the [fixture maintenance guidance](../../fixtures/README.md).
- Report the boundary actually exercised: a stubbed command is not native CLI evidence, a simulated DOM is not a real browser, and captured or synthetic plans are not current backend validation. Follow the [evidence classes and limits](../../fixtures/COVERAGE.md#evidence-classes); name unrun or blocked checks rather than inferring success.

---

## Python

### Running Tests

```bash
direnv exec . just test          # All tests (JS + Python)
direnv exec . just test-py       # Python only
direnv exec . just test-py-supported  # Python 3.12, 3.13, and 3.14
direnv exec . just check         # all hooks, unit suites, and golden checks
direnv exec . uv run prek run --all-files  # equivalent direct command
```

Run these commands from the repository root through direnv. Every change must pass `just check`; the focused commands are for diagnosis, not alternative validation routes. `prek.toml` defines the full suite for both `just check` and normal commits. It rebuilds the browser template before unit tests. Missing templates fail the HTML tests rather than skipping them; the focused Python helpers also build the template. Unit and golden hooks run in full even when no filenames match. Stage intended additions first; `--all-files` includes tracked files and their on-disk edits, not untracked files. If a hook fixes files, inspect and restage those changes before rerunning. Review the final diff after success. Prek reports hook results and failure diagnostics; add `--verbose` when capturing successful hook output to a log. Native size checking applies to staged additions, and JavaScript lint/format hooks cover `js/src`, `js/tests`, and `js/scripts` with their existing generated/vendor/style exclusions.

### Conventions

- **Standalone functions, no classes.** `test_` functions only. Dataclasses are fine.
- **File layout**: mirror source — `cli.py` → `test_cli.py`, `browser.py` → `test_browser.py`
- **Naming**: `test_<function>_<scenario>_<expected_outcome>`
- **Type annotations**: `-> None` on all tests, typed fixture params (`monkeypatch: pytest.MonkeyPatch`, `tmp_path: Path`, `capsys: pytest.CaptureFixture[str]`)
- **Parametrize**: `@pytest.mark.parametrize` with frozen dataclass cases and `ids=lambda c: c.name`. Skip if assertion logic diverges — write separate functions.
- **Docstrings**: well-named test functions don't need docstrings. Only add them for complex setup, non-obvious assertions, or edge case rationale. Never restate the name.
- **Mocking**: `monkeypatch` over `unittest.mock.patch`. Use mock only for method chains, with a comment explaining why.
- **Assertions**: no redundant messages — pytest shows expected vs actual. Add messages only for parametrized or multi-step assertions.
- **Side effects**: `try/finally` when monkeypatch can't handle cleanup (e.g., reassigning `__file__`).
- **Fixtures**: built-in (`tmp_path`, `capsys`, `monkeypatch`). Golden plan fixtures live in `fixtures/golden/<name>/` (shared with JS). See [fixtures/README.md](../../fixtures/README.md) for layout, regen tooling, and the `--check` mode used by `direnv exec . just test-golden`.

---

## TypeScript (Bun)

### Running Tests

```bash
direnv exec . just test-js       # All JS tests
```

### Conventions

- **Structure**: `describe` blocks group related tests, `test` blocks (not `it`) define cases. Max 2 levels of nesting.
- **File layout**: mirror source with `kebab-case.test.ts`
- **Naming**: plain English, lowercase, describe behavior
- **Result types**: test both `ok` and error branches. Narrow with `if (result.ok)` / `if (!result.ok)` before asserting. Zod v4 errors are **lowercase**.
- **Fixtures**: `loadFixture("mixed-changes")` from `../helpers/load-fixture.ts` — resolves to `fixtures/golden/<name>/plan.json`. Shared with Python. See [fixtures/README.md](../../fixtures/README.md) for the per-fixture layout.
- **Mocking**: prefer passing test data to pure functions over mocking. Use `for...of` inside a test for iteration-based parametrization.
- **Non-null assertions**: `!` with `// biome-ignore lint/style/noNonNullAssertion:` comment explaining why.
