"""Language layer: structured mapping, validation and grounding checks (no network)."""
from converge import ai
from converge.engine.evaluate import evaluate


def test_llm_output_is_validated_against_lever_registry(simple_plan, monkeypatch):
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
    monkeypatch.setattr(ai, "_call_structured", lambda *a, **k: fake)
    out = ai._interpret_llm(simple_plan, "anything", "A")
    paths = [c["path"] for c in out["changes"]]
    assert paths == ["shared.property.enabled", "people.B.career_breaks"]
    assert len(out["rejected"]) == 2


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
    monkeypatch.setattr(ai, "llm_available", lambda: False)
    out = ai.explain(evaluate(simple_plan))
    assert out["mode"] == "deterministic" and out["text"]
