"""Language layer: structured mapping, validation and grounding checks (no network)."""
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from converge import ai, config
from converge.engine.evaluate import evaluate
from converge.models import Change


@pytest.fixture(params=["anthropic", "openai"])
def mocked_provider(request, monkeypatch):
    provider = request.param
    create = Mock()
    endpoint = SimpleNamespace(create=create)
    client = SimpleNamespace(messages=endpoint) if provider == "anthropic" else SimpleNamespace(responses=endpoint)
    module_name, constructor = ("anthropic", "Anthropic") if provider == "anthropic" else ("openai", "OpenAI")
    module = __import__(module_name)
    monkeypatch.setattr(module, constructor, Mock(return_value=client))
    monkeypatch.setattr(config, "LLM_PROVIDER", provider)
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "fake-anthropic-key")
    monkeypatch.setattr(config, "OPENAI_API_KEY", "fake-openai-key")
    monkeypatch.setattr(config, "ANTHROPIC_MODEL", "claude-haiku-5-5")
    monkeypatch.setattr(config, "OPENAI_MODEL", "gpt-6-luna")

    def payload(data):
        text = json.dumps(data)
        create.side_effect = None
        create.return_value = (
            SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=text)])
            if provider == "anthropic" else SimpleNamespace(status="completed", output_text=text)
        )

    return provider, create, payload


@pytest.mark.parametrize(("selection", "anthropic_key", "openai_key", "expected"), [
    ("auto", "", "", None),
    ("auto", "present", "present", "anthropic"),
    ("auto", "", "present", "openai"),
    ("anthropic", "", "present", "anthropic"),
    ("openai", "present", "", "openai"),
])
def test_provider_selection(monkeypatch, selection, anthropic_key, openai_key, expected):
    monkeypatch.setattr(config, "LLM_PROVIDER", selection)
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", anthropic_key)
    monkeypatch.setattr(config, "OPENAI_API_KEY", openai_key)
    assert config.llm_provider() == expected
    assert ai.llm_available() == bool({"anthropic": anthropic_key, "openai": openai_key}.get(expected))


def test_llm_output_is_validated_against_lever_registry(simple_plan, mocked_provider):
    provider, create, payload = mocked_provider
    fake = {
        "summary": "Ben takes six months off and the couple buys a home.",
        "changes": [
            {"path": "shared.property.enabled", "number": None, "text": None, "flag": True},
            {"path": "people.B.opening_cash", "number": 1e9, "text": None, "flag": None},  # not a lever
            {"path": "shared.property.purchase", "number": None, "text": "2029-13", "flag": None},  # invalid month
        ],
        "career_break": {"person_id": "B", "start": "2027-01", "months": 6, "income_pct": 0, "one_off_cost_chf": 0},
        "clarification": None,
    }
    payload(fake)
    out = ai.interpret(simple_plan, "anything", "A")
    assert out["mode"] == "llm" and out["provider"] == provider
    paths = [c["path"] for c in out["changes"]]
    assert paths == ["shared.property.enabled", "people.B.career_breaks"]
    assert len(out["rejected"]) == 2
    kwargs = create.call_args.kwargs
    assert kwargs["model"] == ai.llm_model(provider)
    assert not {"betas", "fallbacks"} & kwargs.keys()
    if provider == "anthropic":
        assert kwargs["max_tokens"] == 1000
        assert kwargs["output_config"]["effort"] == "low"
        schema = kwargs["output_config"]["format"]["schema"]
    else:
        assert kwargs["max_output_tokens"] == 1000
        assert kwargs["store"] is False
        assert kwargs["text"]["format"]["strict"] is True
        schema = kwargs["text"]["format"]["schema"]
    assert schema["additionalProperties"] is False and "changes" in schema["required"]


def test_invalid_structured_output_uses_offline_parser(simple_plan, mocked_provider):
    provider, _, payload = mocked_provider
    payload({"summary": "Missing required properties"})
    out = ai.interpret(simple_plan, "Ben takes 12 months off from Jan 2028", "A")
    assert out["mode"] == "offline"
    assert f"{ai.PROVIDER_NAMES[provider]} interpretation failed (ValidationError)" in out["notice"]
    assert out["changes"][0]["path"] == "people.B.career_breaks"


def test_transport_errors_fall_back_without_exposing_details(simple_plan, mocked_provider, caplog):
    provider, create, _ = mocked_provider
    create.side_effect = TimeoutError("secret request detail")
    interpreted = ai.interpret(simple_plan, "Ben takes 12 months off from Jan 2028", "A")
    explained = ai.explain(evaluate(simple_plan))
    assert interpreted["mode"] == "offline"
    assert explained["mode"] == "deterministic"
    for result in (interpreted, explained):
        assert ai.PROVIDER_NAMES[provider] in result["notice"] and "TimeoutError" in result["notice"]
        assert "secret request detail" not in result["notice"]
    assert "secret request detail" not in caplog.text
    assert create.call_count == 2


def test_explanation_uses_grounding_for_both_providers(simple_plan, mocked_provider):
    provider, create, payload = mocked_provider
    ev = evaluate(simple_plan)
    payload({"text": f"Ana's lowest cash is CHF {ev['people'][0]['min_cash']:,.0f}."})
    out = ai.explain(ev)
    assert out["mode"] == "llm" and out["provider"] == provider and out["grounded"]
    assert create.call_args.kwargs["max_tokens" if provider == "anthropic" else "max_output_tokens"] == 500

    payload({"text": "Ana will have CHF 987,654."})
    out = ai.explain(ev)
    assert out["mode"] == "deterministic" and "failed grounding" in out["notice"]
    assert out["text"] == ai.deterministic_summary(ev)


def test_grounding_rejects_invented_numbers(simple_plan):
    ev = evaluate(simple_plan)
    facts = {"people": [{"name": p["name"], "min_cash": p["min_cash"], "floor": p["floor"]} for p in ev["people"]]}
    ok, _ = ai.grounded(f"Ana's lowest cash is CHF {ev['people'][0]['min_cash']:,.0f}.", facts)
    assert ok
    ok, bad = ai.grounded("Ana will have CHF 987,654 in 2030.", facts)
    assert not ok and 987654 in bad


def test_offline_parser_examples(simple_plan):
    out = ai._interpret_offline(simple_plan, "I want to take six months off next year, but we still want to buy a house before 2030", "B")
    paths = {c["path"] for c in out["changes"]}
    assert {"people.B.career_breaks", "shared.property.enabled", "shared.property.target_date"} <= paths
    out = ai._interpret_offline(simple_plan, "What if the mortgage rate rises to 3.5%?", "A")
    assert out["changes"] == [{"path": "shared.property.mortgage_rate", "value": 0.035, "note": None}]
    out = ai._interpret_offline(simple_plan, "blah", "A")
    assert out["changes"] == [] and out["clarification"]


def test_explain_without_key_is_deterministic(simple_plan, monkeypatch):
    monkeypatch.setattr(config, "LLM_PROVIDER", "auto")
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(config, "OPENAI_API_KEY", "")
    out = ai.explain(evaluate(simple_plan))
    assert out["mode"] == "deterministic" and out["text"] and "notice" not in out


def test_configured_provider_with_missing_key_is_visible(simple_plan, monkeypatch):
    monkeypatch.setattr(config, "LLM_PROVIDER", "openai")
    monkeypatch.setattr(config, "OPENAI_API_KEY", "")
    out = ai.interpret(simple_plan, "Ben takes 12 months off from Jan 2028", "A")
    assert out["mode"] == "offline" and "OpenAI interpretation failed (MissingAPIKey)" in out["notice"]


def test_offline_parser_handles_exact_demo_phrase(demo_plan, monkeypatch):
    monkeypatch.setattr(config, "LLM_PROVIDER", "auto")
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(config, "OPENAI_API_KEY", "")
    out = ai.interpret(demo_plan, "Emil takes 12 months off from Jan 2028", "P00918")
    assert out["mode"] == "offline" and "notice" not in out
    revised = ai.apply_changes(demo_plan, [Change(**change) for change in out["changes"]])
    emil_break, = revised.person("P00809").career_breaks
    assert (emil_break.start, emil_break.months, emil_break.income_pct) == ("2028-01", 12, 0)
