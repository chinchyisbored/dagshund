import pytest

from dagshund.filter import (
    _classify_token,
    _ExactToken,
    _FuzzyToken,
    _match_token,
    _parse_filter_query,
    _StatusToken,
    _tokenize,
    _TypeToken,
    build_query_predicate,
)

# --- _tokenize ---


def test_tokenize_empty_string_returns_empty() -> None:
    assert _tokenize("") == []


def test_tokenize_single_word() -> None:
    assert _tokenize("pipeline") == ["pipeline"]


def test_tokenize_multiple_words() -> None:
    assert _tokenize("type:jobs pipeline") == ["type:jobs", "pipeline"]


def test_tokenize_quoted_phrase_preserved() -> None:
    assert _tokenize('"etl pipeline"') == ['"etl pipeline"']


def test_tokenize_mixed_quoted_and_bare() -> None:
    assert _tokenize('type:jobs "etl pipeline" status:added') == [
        "type:jobs",
        '"etl pipeline"',
        "status:added",
    ]


# --- _classify_token ---


def test_classify_type_token() -> None:
    assert _classify_token("type:jobs") == _TypeToken(value="jobs")


def test_classify_status_token() -> None:
    assert _classify_token("status:added") == _StatusToken(value="added")


def test_classify_exact_token() -> None:
    assert _classify_token('"etl_pipeline"') == _ExactToken(value="etl_pipeline")


def test_classify_fuzzy_token() -> None:
    assert _classify_token("pipeline") == _FuzzyToken(value="pipeline")


def test_classify_empty_type_value_returns_none() -> None:
    assert _classify_token("type:") is None


def test_classify_empty_status_value_returns_none() -> None:
    assert _classify_token("status:") is None


def test_classify_empty_quoted_string_returns_fuzzy() -> None:
    result = _classify_token('""')

    assert isinstance(result, _FuzzyToken)


# --- _parse_filter_query ---


def test_parse_filter_query_lowercases_input() -> None:
    tokens = _parse_filter_query("Type:Jobs")

    assert tokens == [_TypeToken(value="jobs")]


def test_parse_filter_query_strips_whitespace() -> None:
    tokens = _parse_filter_query("  pipeline  ")

    assert tokens == [_FuzzyToken(value="pipeline")]


def test_parse_filter_query_drops_invalid_tokens() -> None:
    tokens = _parse_filter_query("type: pipeline")

    assert tokens == [_FuzzyToken(value="pipeline")]


def test_parse_filter_query_multiple_tokens() -> None:
    tokens = _parse_filter_query('type:jobs status:added "etl_pipeline"')

    assert tokens == [
        _TypeToken(value="jobs"),
        _StatusToken(value="added"),
        _ExactToken(value="etl_pipeline"),
    ]


# --- _match_token ---


def test_match_type_token_substring_match() -> None:
    assert _match_token(_TypeToken(value="job"), "resources.jobs.etl", {"action": "create"})


def test_match_type_token_no_match() -> None:
    assert not _match_token(_TypeToken(value="schema"), "resources.jobs.etl", {"action": "create"})


def test_match_status_token_exact_match() -> None:
    assert _match_token(_StatusToken(value="added"), "resources.jobs.etl", {"action": "create"})


def test_match_status_token_no_match() -> None:
    assert not _match_token(_StatusToken(value="removed"), "resources.jobs.etl", {"action": "create"})


def test_match_exact_token_exact_name_match() -> None:
    assert _match_token(_ExactToken(value="etl"), "resources.jobs.etl", {"action": "create"})


def test_match_exact_token_partial_name_no_match() -> None:
    assert not _match_token(_ExactToken(value="et"), "resources.jobs.etl", {"action": "create"})


def test_match_fuzzy_token_substring_match() -> None:
    assert _match_token(_FuzzyToken(value="pipe"), "resources.jobs.etl_pipeline", {"action": "create"})


def test_match_fuzzy_token_no_match() -> None:
    assert not _match_token(_FuzzyToken(value="xyz"), "resources.jobs.etl_pipeline", {"action": "create"})


def test_match_fuzzy_token_case_insensitive() -> None:
    assert _match_token(_FuzzyToken(value="pipeline"), "resources.jobs.ETL_Pipeline", {"action": "create"})


@pytest.mark.parametrize(
    ("status", "action"),
    [
        ("added", "create"),
        ("removed", "delete"),
        ("modified", "update"),
        ("modified", "recreate"),
        ("modified", "resize"),
        ("modified", "update_id"),
        ("unchanged", "skip"),
        ("unchanged", ""),
    ],
    ids=["added", "removed", "update", "recreate", "resize", "update_id", "skip", "empty"],
)
def test_match_status_token_all_actions(status: str, action: str) -> None:
    assert _match_token(_StatusToken(value=status), "resources.jobs.x", {"action": action})


# --- build_query_predicate ---


def test_build_query_predicate_empty_string_returns_none() -> None:
    assert build_query_predicate("") is None


def test_build_query_predicate_whitespace_only_returns_none() -> None:
    assert build_query_predicate("   ") is None


def test_build_query_predicate_invalid_tokens_only_returns_none() -> None:
    assert build_query_predicate("type: status:") is None


def test_build_query_predicate_single_token_matches() -> None:
    predicate = build_query_predicate("type:jobs")

    assert predicate is not None
    assert predicate("resources.jobs.etl", {"action": "create"})
    assert not predicate("resources.schemas.analytics", {"action": "create"})


def test_build_query_predicate_multiple_tokens_and_together() -> None:
    predicate = build_query_predicate("type:jobs status:added")

    assert predicate is not None
    assert predicate("resources.jobs.etl", {"action": "create"})
    assert not predicate("resources.jobs.etl", {"action": "skip"})
    assert not predicate("resources.schemas.analytics", {"action": "create"})


def test_build_query_predicate_exact_match() -> None:
    predicate = build_query_predicate('"etl_pipeline"')

    assert predicate is not None
    assert predicate("resources.jobs.etl_pipeline", {"action": "create"})
    assert not predicate("resources.jobs.etl_pipeline_v2", {"action": "create"})


def test_build_query_predicate_fuzzy_match() -> None:
    predicate = build_query_predicate("pipeline")

    assert predicate is not None
    assert predicate("resources.jobs.etl_pipeline", {"action": "create"})
    assert predicate("resources.jobs.data_pipeline", {"action": "create"})
    assert not predicate("resources.jobs.etl_job", {"action": "create"})
