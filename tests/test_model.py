"""Tests for model.py — parser boundary coverage."""

import json
from pathlib import Path
from typing import Any

import pytest

from dagshund.model import (
    UNSET,
    ActionType,
    UnsetSentinel,
    parse_action,
    parse_field_change,
    parse_plan,
    parse_plan_data,
    parse_resource_change,
)
from dagshund.redaction import SecretComparisonFacts
from dagshund.types import DagshundError

GOLDEN_DIR = Path(__file__).parent.parent / "fixtures" / "golden"
GOLDEN_PLANS = sorted(p for p in GOLDEN_DIR.iterdir() if p.is_dir() and (p / "plan.json").exists())


# --- golden round-trip ---


@pytest.mark.parametrize(
    "fixture_dir",
    GOLDEN_PLANS,
    ids=[p.name for p in GOLDEN_PLANS],
)
def test_parse_plan_golden_round_trip(fixture_dir: Path) -> None:
    raw = (fixture_dir / "plan.json").read_text()
    plan = parse_plan(raw)

    expected = json.loads(raw)
    assert dict(plan.raw) == expected


# --- parse_action ---


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("create", ActionType.CREATE),
        ("delete", ActionType.DELETE),
        ("update", ActionType.UPDATE),
        ("recreate", ActionType.RECREATE),
        ("resize", ActionType.RESIZE),
        ("update_id", ActionType.UPDATE_ID),
        ("skip", ActionType.SKIP),
        ("", ActionType.EMPTY),
    ],
    ids=["create", "delete", "update", "recreate", "resize", "update_id", "skip", "empty"],
)
def test_parse_action_known_values(value: str, expected: ActionType) -> None:
    assert parse_action(value) is expected


@pytest.mark.parametrize(
    "value",
    ["nope", "CREATE", "Delete", "  create", 42, None, True, 3.14, [], {}],
    ids=["unknown_str", "uppercase", "mixed_case", "leading_space", "int", "none", "bool", "float", "list", "dict"],
)
def test_parse_action_unknown_returns_unknown(value: object) -> None:
    assert parse_action(value) is ActionType.UNKNOWN


# --- parse_field_change ---


def test_parse_field_change_full_dict() -> None:
    raw = {"action": "update", "reason": "changed", "old": 1, "new": 2, "remote": 3}

    result = parse_field_change(raw)

    assert result.action is ActionType.UPDATE
    assert result.reason == "changed"
    assert result.old == 1
    assert result.new == 2
    assert result.remote == 3


def test_parse_field_change_absent_keys_are_unset() -> None:
    result = parse_field_change({})

    assert result.old is UNSET
    assert result.new is UNSET
    assert result.remote is UNSET


def test_parse_field_change_null_values_are_none() -> None:
    raw = {"old": None, "new": None, "remote": None}

    result = parse_field_change(raw)

    assert result.old is None
    assert result.new is None
    assert result.remote is None


def test_parse_field_change_unset_vs_none_distinction() -> None:
    present_null = parse_field_change({"old": None})
    absent = parse_field_change({})

    assert present_null.old is None
    assert absent.old is UNSET
    assert present_null.old is not absent.old


@pytest.mark.parametrize("value", ["not a dict", 42, None, [], True])
def test_parse_field_change_non_dict_raises(value: object) -> None:
    with pytest.raises(DagshundError, match="field change must be an object"):
        parse_field_change(value)


def test_parse_field_change_non_string_reason_is_none() -> None:
    result = parse_field_change({"reason": 42})

    assert result.reason is None


def test_parse_field_change_complex_payload_values() -> None:
    raw = {"old": {"nested": [1, 2]}, "new": [3, 4, 5]}

    result = parse_field_change(raw)

    assert result.old == {"nested": [1, 2]}
    assert result.new == [3, 4, 5]


# --- parse_resource_change ---


def test_parse_resource_change_full_entry() -> None:
    raw = {
        "action": "create",
        "changes": {"name": {"action": "create", "new": "foo"}},
        "new_state": {"value": {"name": "foo"}},
        "depends_on": [{"node": "resources.jobs.other"}],
    }

    result = parse_resource_change("resources.jobs.my_job", raw)

    assert result.key == "resources.jobs.my_job"
    assert result.action is ActionType.CREATE
    assert "name" in result.changes
    assert result.changes["name"].new == "foo"
    assert result.new_state == {"value": {"name": "foo"}}
    assert result.depends_on == (("resources.jobs.other", None),)


@pytest.mark.parametrize("value", ["garbage", None, 42, []])
def test_parse_resource_change_non_dict_raises(value: object) -> None:
    with pytest.raises(DagshundError, match=r'resource "resources.jobs.x" must be an object'):
        parse_resource_change("resources.jobs.x", value)


@pytest.mark.parametrize("value", ["not a dict", 42, [], True])
def test_parse_resource_change_non_dict_changes_raises(value: object) -> None:
    with pytest.raises(DagshundError, match=r'changes for resource "k" must be an object or null'):
        parse_resource_change("k", {"changes": value})


def test_parse_resource_change_null_changes_are_accepted() -> None:
    assert parse_resource_change("k", {"changes": None}).changes == {}


def test_parse_resource_change_non_dict_field_raises_with_context() -> None:
    with pytest.raises(DagshundError, match=r'change "name" for resource "k" must be an object'):
        parse_resource_change("k", {"changes": {"name": None}})


def test_parse_resource_change_non_string_change_keys_skipped() -> None:
    result = parse_resource_change("k", {"changes": {42: {"action": "create"}}})

    assert result.changes == {}


def test_parse_resource_change_states_preserved() -> None:
    raw = {"new_state": {"x": 1}, "remote_state": {"y": 2}}

    result = parse_resource_change("k", raw)

    assert result.new_state == {"x": 1}
    assert result.remote_state == {"y": 2}


def test_parse_resource_change_missing_states_are_none() -> None:
    result = parse_resource_change("k", {})

    assert result.new_state is None
    assert result.remote_state is None


# --- _parse_depends_on (via parse_resource_change) ---


def test_depends_on_with_labels() -> None:
    raw = {
        "depends_on": [
            {"node": "a", "label": "upstream"},
            {"node": "b", "label": "sidecar"},
        ]
    }

    result = parse_resource_change("k", raw)

    assert result.depends_on == (("a", "upstream"), ("b", "sidecar"))


def test_depends_on_without_labels() -> None:
    raw = {"depends_on": [{"node": "a"}, {"node": "b"}]}

    result = parse_resource_change("k", raw)

    assert result.depends_on == (("a", None), ("b", None))


def test_depends_on_non_list_ignored() -> None:
    result = parse_resource_change("k", {"depends_on": "not a list"})

    assert result.depends_on == ()


def test_depends_on_non_dict_items_skipped() -> None:
    raw = {"depends_on": ["just a string", 42, {"node": "valid"}]}

    result = parse_resource_change("k", raw)

    assert result.depends_on == (("valid", None),)


def test_depends_on_missing_node_skipped() -> None:
    raw = {"depends_on": [{"label": "orphan"}, {"node": "ok"}]}

    result = parse_resource_change("k", raw)

    assert result.depends_on == (("ok", None),)


def test_depends_on_non_string_node_skipped() -> None:
    raw = {"depends_on": [{"node": 42}, {"node": "ok"}]}

    result = parse_resource_change("k", raw)

    assert result.depends_on == (("ok", None),)


def test_depends_on_non_string_label_becomes_none() -> None:
    raw = {"depends_on": [{"node": "a", "label": 99}]}

    result = parse_resource_change("k", raw)

    assert result.depends_on == (("a", None),)


# --- parse_plan_data ---


def test_parse_plan_data_extracts_metadata() -> None:
    raw = {
        "plan": {},
        "plan_version": 3,
        "cli_version": "0.242.0",
        "lineage": "abc-123",
        "serial": 7,
    }

    result = parse_plan_data(raw)

    assert result.plan_version == 3
    assert result.cli_version == "0.242.0"
    assert result.lineage == "abc-123"
    assert result.serial == 7


def test_parse_plan_data_missing_metadata_is_none() -> None:
    result = parse_plan_data({"plan": {}})

    assert result.plan_version is None
    assert result.cli_version is None
    assert result.lineage is None
    assert result.serial is None


def test_parse_plan_data_bool_plan_version_rejected() -> None:
    result = parse_plan_data({"plan": {}, "plan_version": True})

    assert result.plan_version is None


def test_parse_plan_data_string_serial_rejected() -> None:
    result = parse_plan_data({"plan": {}, "serial": "7"})

    assert result.serial is None


def test_parse_plan_data_missing_plan_key_gives_empty_resources() -> None:
    result = parse_plan_data({})

    assert result.resources == {}


def test_parse_plan_data_non_dict_plan_value_gives_empty_resources() -> None:
    result = parse_plan_data({"plan": "not a dict"})

    assert result.resources == {}


def test_parse_plan_data_preserves_raw() -> None:
    raw = {"plan": {}, "extra_key": "preserved"}

    result = parse_plan_data(raw)

    assert result.raw is raw
    assert result.raw["extra_key"] == "preserved"


def test_parse_plan_data_resource_keys_match_enclosing_mapping_keys() -> None:
    result = parse_plan_data({"plan": {"resources.jobs.actual": {"action": "create"}}})

    assert result.resources["resources.jobs.actual"].key == "resources.jobs.actual"


def test_parse_plan_data_preserves_safe_provider_change_values_and_leaf_distinctions() -> None:
    raw = {
        "plan": {
            "resources.model_provider_services.provider": {
                "changes": {
                    "config.azure_openai.direct": {
                        "action": "update",
                        "old": {
                            "base_url": "https://safe.example",
                            "service_credential": {"name": "credentials/safe"},
                        },
                        "new": {
                            "base_url": "https://safe.example",
                            "service_credential": {"name": "credentials/safe"},
                        },
                        "remote": {
                            "base_url": "https://safe.example",
                            "service_credential": {"name": "credentials/safe"},
                        },
                    },
                    "config.openai.direct.api_key": {
                        "action": "update",
                        "old": {},
                        "new": "",
                    },
                }
            }
        }
    }

    result = parse_plan_data(raw)

    changes = result.resources["resources.model_provider_services.provider"].changes
    assert changes["config.azure_openai.direct"].old == {
        "base_url": "https://safe.example",
        "service_credential": {"name": "credentials/safe"},
    }
    assert changes["config.azure_openai.direct"].new == {
        "base_url": "https://safe.example",
        "service_credential": {"name": "credentials/safe"},
    }
    assert changes["config.azure_openai.direct"].remote == {
        "base_url": "https://safe.example",
        "service_credential": {"name": "credentials/safe"},
    }
    assert changes["config.openai.direct.api_key"].old == {}
    assert changes["config.openai.direct.api_key"].new == ""
    assert "ROTATED_SENTINEL" not in json.dumps(result.raw)


def test_parse_plan_data_redacts_provider_credentials_and_aggregate_changes() -> None:
    raw = {
        "plan": {
            "resources.model_provider_services.provider": {
                "action": "update",
                "new_state": {
                    "value": {
                        "config": {
                            "amazon_bedrock": {
                                "direct": {
                                    "aws_access_key": {
                                        "access_key_id": "AWS_ID_SENTINEL",
                                        "secret_access_key": {"plaintext": "AWS_SECRET_SENTINEL"},
                                    }
                                }
                            }
                        }
                    }
                },
                "changes": {
                    "config.amazon_bedrock.direct.aws_access_key.access_key_id": {
                        "action": "update",
                        "old": "OLD_ID_SENTINEL",
                        "new": "NEW_ID_SENTINEL",
                        "remote": "REMOTE_ID_SENTINEL",
                    },
                    "config.amazon_bedrock.direct": {
                        "action": "update",
                        "old": {"secret_access_key": {"plaintext": "OLD_SECRET_SENTINEL"}},
                        "new": {"secret_access_key": {"plaintext": "NEW_SECRET_SENTINEL"}},
                        "remote": {"secret_access_key": {"plaintext": "REMOTE_SECRET_SENTINEL"}},
                    },
                },
            }
        }
    }

    result = parse_plan_data(raw)

    serialized = json.dumps(result.raw)
    for sentinel in (
        "AWS_ID_SENTINEL",
        "AWS_SECRET_SENTINEL",
        "OLD_ID_SENTINEL",
        "NEW_ID_SENTINEL",
        "REMOTE_ID_SENTINEL",
        "OLD_SECRET_SENTINEL",
        "NEW_SECRET_SENTINEL",
        "REMOTE_SECRET_SENTINEL",
    ):
        assert sentinel not in serialized
    assert (
        raw["plan"]["resources.model_provider_services.provider"]["new_state"]["value"]["config"]["amazon_bedrock"][
            "direct"
        ]["aws_access_key"]["access_key_id"]
        == "AWS_ID_SENTINEL"
    )


def test_parse_plan_data_redacts_every_schema_provider_credential_arm() -> None:
    credential_paths = (
        ("anthropic", "direct", "api_key", "plaintext"),
        ("azure_openai", "direct", "api_key", "plaintext"),
        ("azure_openai", "direct", "entra_service_principal", "client_secret", "plaintext"),
        ("custom", "direct", "api_key", "plaintext"),
        ("gemini_enterprise", "direct", "api_key", "plaintext"),
        ("microsoft_foundry", "direct", "api_key", "plaintext"),
        ("microsoft_foundry", "direct", "entra_service_principal", "client_secret", "plaintext"),
        ("openai", "direct", "api_key", "plaintext"),
        ("amazon_bedrock", "direct", "aws_access_key", "secret_access_key", "plaintext"),
        ("amazon_bedrock", "direct", "aws_access_key", "access_key_id"),
    )
    config: dict[str, Any] = {}
    for index, path in enumerate(credential_paths):
        current: dict[str, Any] = config
        for segment in path[:-1]:
            current = current.setdefault(segment, {})
        current[path[-1]] = f"PROVIDER_SENTINEL_{index}"

    result = parse_plan_data(
        {"plan": {"resources.model_provider_services.provider": {"new_state": {"value": {"config": config}}}}}
    )

    serialized = json.dumps(result.raw)
    for index in range(len(credential_paths)):
        assert f"PROVIDER_SENTINEL_{index}" not in serialized
    assert "noncredential" not in serialized


def test_parse_plan_data_redacts_uc_secret_values_without_mutating_input() -> None:
    raw = {
        "plan": {
            "resources.secrets.api_token": {
                "action": "update",
                "new_state": {
                    "effective_value": "outer-effective-value",
                    "value": {
                        "name": "api_token",
                        "value": "new-secret-value",
                        "effective_value": "new-effective-value",
                    },
                },
                "remote_state": {
                    "name": "api_token",
                    "value": "[redacted]",
                    "effective_value": "[redacted]",
                },
                "changes": {
                    "value": {
                        "action": "update",
                        "old": "",
                        "new": "[redacted]",
                        "remote": "[redacted]",
                    }
                },
            },
            "resources.secret_scopes.legacy": {"new_state": {"value": {"value": "not-a-uc-secret-value"}}},
        }
    }

    result = parse_plan_data(raw)

    secret = result.resources["resources.secrets.api_token"]
    assert secret.new_state == {
        "effective_value": "[redacted]",
        "value": {
            "name": "api_token",
            "value": "[redacted]",
            "effective_value": "[redacted]",
        },
    }
    assert secret.remote_state == {
        "name": "api_token",
        "value": "[redacted]",
        "effective_value": "[redacted]",
    }
    assert secret.changes["value"].old == ""
    assert secret.changes["value"].new == "[redacted]"
    assert secret.changes["value"].remote == "[redacted]"
    assert result.resources["resources.secret_scopes.legacy"].new_state == {"value": {"value": "not-a-uc-secret-value"}}
    assert "new-secret-value" not in json.dumps(result.raw)
    assert raw["plan"]["resources.secrets.api_token"]["new_state"]["value"]["value"] == "new-secret-value"
    assert raw["plan"]["resources.secrets.api_token"]["new_state"]["effective_value"] == "outer-effective-value"


@pytest.mark.parametrize(
    ("field", "payload"),
    [
        ("value", "UC_SECRET_SENTINEL"),
        ("value", ["UC_SECRET_SENTINEL"]),
        ("value", {"nested": ["UC_SECRET_SENTINEL"]}),
        ("effective_value", {"current_value": "UC_SECRET_SENTINEL"}),
    ],
    ids=["value-scalar", "value-array", "value-object", "effective-value-object"],
)
def test_parse_plan_data_redacts_unknown_secret_change_payloads_without_mutation(field: str, payload: object) -> None:
    raw = {"plan": {"resources.secrets.token": {"changes": {field: {"current_value": payload}}}}}

    result = parse_plan_data(raw)
    redacted = json.loads(json.dumps(result.raw))

    assert redacted["plan"]["resources.secrets.token"]["changes"][field]["current_value"] == "[redacted]"
    assert raw["plan"]["resources.secrets.token"]["changes"][field]["current_value"] == payload
    assert "UC_SECRET_SENTINEL" not in json.dumps(result.raw)


def test_parse_plan_data_preserves_only_string_or_null_secret_change_metadata() -> None:
    raw = {
        "plan": {
            "resources.secrets.token": {
                "changes": {
                    "value": {
                        "action": {"sentinel": "UC_ACTION_SENTINEL"},
                        "reason": ["UC_REASON_SENTINEL"],
                        "current_value": {"sentinel": "UC_SECRET_SENTINEL"},
                        "custom_metadata": "also-secret",
                    }
                }
            }
        }
    }

    result = parse_plan_data(raw)
    redacted = json.loads(json.dumps(result.raw))
    redacted_change = redacted["plan"]["resources.secrets.token"]["changes"]["value"]

    assert redacted_change == {
        "action": "[redacted]",
        "reason": "[redacted]",
        "current_value": "[redacted]",
        "custom_metadata": "[redacted]",
    }
    assert raw["plan"]["resources.secrets.token"]["changes"]["value"]["current_value"] == {
        "sentinel": "UC_SECRET_SENTINEL"
    }


@pytest.mark.parametrize(
    "malformed_state",
    ["UC_SECRET_SENTINEL", 42, True, ["UC_SECRET_SENTINEL"]],
    ids=["string", "number", "boolean", "array"],
)
def test_parse_plan_data_redacts_malformed_uc_secret_states(malformed_state: object) -> None:
    raw = {
        "plan": {
            "resources.secrets.api_token": {
                "new_state": malformed_state,
                "remote_state": malformed_state,
            }
        }
    }

    result = parse_plan_data(raw)

    secret = result.resources["resources.secrets.api_token"]
    assert secret.new_state == "[redacted]"
    assert secret.remote_state == "[redacted]"
    assert "UC_SECRET_SENTINEL" not in json.dumps(result.raw)
    assert raw["plan"]["resources.secrets.api_token"]["new_state"] == malformed_state


def test_parse_plan_data_preserves_null_and_absent_uc_secret_states() -> None:
    raw = {
        "plan": {
            "resources.secrets.null_state": {"new_state": None, "remote_state": None},
            "resources.secrets.absent_state": {},
        }
    }

    result = parse_plan_data(raw)
    redacted = json.loads(json.dumps(result.raw))

    assert redacted["plan"]["resources.secrets.null_state"]["new_state"] is None
    assert "new_state" not in redacted["plan"]["resources.secrets.absent_state"]


def test_parse_plan_data_redacts_malformed_uc_secret_entry_then_rejects() -> None:
    raw = {"plan": {"resources.secrets.api_token": "UC_SECRET_SENTINEL"}}

    with pytest.raises(DagshundError, match=r'resource "resources.secrets.api_token" must be an object') as exc_info:
        parse_plan_data(raw)

    assert "UC_SECRET_SENTINEL" not in str(exc_info.value)


def test_parse_plan_data_redacts_malformed_uc_secret_change_then_rejects() -> None:
    raw = {"plan": {"resources.secrets.api_token": {"changes": {"value": "plaintext-value-change"}}}}

    with pytest.raises(DagshundError, match=r'change "value" for resource "resources.secrets.api_token"') as exc_info:
        parse_plan_data(raw)

    assert "plaintext-value-change" not in str(exc_info.value)


# --- UnsetSentinel identity ---


def test_unset_is_singleton() -> None:
    assert UNSET is UnsetSentinel.UNSET


def test_unset_is_not_none() -> None:
    assert UNSET is not None
    assert UNSET != None  # noqa: E711


def test_unset_repr() -> None:
    assert "UNSET" in repr(UNSET)


def test_parse_plan_attaches_safe_secret_comparison_facts() -> None:
    raw = json.dumps(
        {
            "plan": {
                "resources.secrets.token": {
                    "changes": {
                        "value": {
                            "action": "update",
                            "old": {"nested": [True, 2]},
                            "new": {"nested": [False, 2]},
                            "remote": {"nested": [True, 2]},
                        }
                    }
                }
            }
        }
    )

    plan = parse_plan(raw)
    facts = plan.resources["resources.secrets.token"].changes["value"].secret_facts

    assert facts is not None
    assert (facts.old_new_equal, facts.old_remote_equal) == (False, True)
    assert "nested" not in repr(facts)
    assert repr(facts) == "SecretComparisonFacts(old_new_equal=False, old_remote_equal=True)"
    assert "[redacted]" in repr(plan.raw)
    assert "nested" not in repr(plan.raw)


def test_parse_plan_attaches_safe_provider_comparison_facts() -> None:
    raw = {
        "plan": {
            "resources.model_provider_services.provider": {
                "changes": {
                    "config.openai.direct.api_key.plaintext": {
                        "action": "update",
                        "old": "OLD_SENTINEL",
                        "new": "NEW_SENTINEL",
                    },
                    "config.azure_openai.direct.api_key.plaintext": {
                        "action": "update",
                        "old": "SAME_SENTINEL",
                        "new": "SAME_SENTINEL",
                        "remote": "REMOTE_SENTINEL",
                    },
                    "config.openai.direct": {
                        "action": "update",
                        "old": {"api_key": {"plaintext": "AGG_OLD"}, "base_url": "https://safe.example"},
                        "new": {"api_key": {"plaintext": "AGG_NEW"}, "base_url": "https://safe.example"},
                    },
                }
            }
        }
    }

    plan = parse_plan_data(raw)
    changes = plan.resources["resources.model_provider_services.provider"].changes

    assert changes["config.openai.direct.api_key.plaintext"].secret_facts == SecretComparisonFacts(
        old_new_equal=False, old_remote_equal=None
    )
    assert changes["config.azure_openai.direct.api_key.plaintext"].secret_facts == SecretComparisonFacts(
        old_new_equal=True, old_remote_equal=False
    )
    assert changes["config.openai.direct"].secret_facts == SecretComparisonFacts(
        old_new_equal=False, old_remote_equal=None
    )
    assert "SENTINEL" not in repr(changes)
    assert "AGG_OLD" not in repr(changes)
    assert "AGG_NEW" not in repr(changes)
    assert "SENTINEL" not in json.dumps(plan.raw)
    assert "AGG_OLD" not in json.dumps(plan.raw)
    assert "AGG_NEW" not in json.dumps(plan.raw)


def test_parse_plan_marker_makes_secret_facts_unknown() -> None:
    raw = {
        "plan": {
            "resources.secrets.token": {
                "changes": {
                    "value": {
                        "action": "update",
                        "old": {"nested": "[REDACTED]"},
                        "new": "new-secret",
                        "remote": "remote-secret",
                    }
                }
            }
        }
    }

    plan = parse_plan_data(raw)
    facts = plan.resources["resources.secrets.token"].changes["value"].secret_facts

    assert facts is not None
    assert (facts.old_new_equal, facts.old_remote_equal) == (None, None)
    assert "new-secret" not in repr(facts)
    assert "remote-secret" not in repr(facts)
