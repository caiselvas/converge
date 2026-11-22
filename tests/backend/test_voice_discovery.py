import asyncio

import pytest
from pydantic import ValidationError

from converge import ai, config
from converge.engine.changes import apply_changes
from converge.engine.evaluate import evaluate
from converge.models import Change, Goal
from converge.seed import default_plan
from converge.voice.extract import Candidates, extract, offline
from converge.voice.memory import Item, Memory
from converge.voice.routes import ingest_turn
from converge.voice.tools import Session, execute_tool, ground_turn


@pytest.fixture
def session(tmp_path, simple_plan, monkeypatch):
    monkeypatch.setattr(config, "LLM_PROVIDER", "auto")
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(config, "OPENAI_API_KEY", "")
    memory = Memory(tmp_path / "voice.sqlite3")
    return Session(memory, memory.start("B"), simple_plan)


def turn(session, text):
    return asyncio.run(ingest_turn(session, "user", text))


def item(**changes):
    return dict(dimension="goals", key="home", kind="fact", confidence=1.0, value="Home",
                quote="I want to buy a home in 2029", why=None) | changes


def test_memory_evidence_and_person_isolation(session):
    memory = session.memory
    with pytest.raises(ValueError):
        Item.model_validate(item(quote=None))
    with pytest.raises(ValueError):
        Item.model_validate(item(kind="unknown", value=None, quote=None))
    utterance = memory.add_turn(session.id, "user", item()["quote"])
    memory.save(session.id, utterance, [Item.model_validate(item()), Item.model_validate(item(quote="invented")),
                    Item.model_validate(item(value="Sabbatical"))])
    [fact] = memory.items("B")
    with pytest.raises(ValueError):
        memory.resolve("A", fact["id"], "confirmed")
    assert memory.resolve("B", fact["id"], "confirmed")[0]["status"] == "confirmed"
    assert memory.resolve("B", fact["id"], "rejected")[0]["status"] == "rejected"
    assert memory.items("A") == []
    memory.clear("B")
    assert memory.items("B") == []
    with pytest.raises(ValueError):
        memory.person(session.id)


def test_extraction_drops_bad_schema_and_evidence(session, monkeypatch):
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "fake")
    output = Candidates.model_validate({"items": [
        item(dimension="imagined"), item(quote="not spoken"), item(value="Sabbatical"),
        item(key="home.permission", dimension="risk_flexibility", kind="unknown", value=None,
             confidence=0.0, quote=None, why="Ask before discussing cash comfort."),
        item(key="home.risk", dimension="risk_flexibility", kind="inference", value="cautious", quote=None),
    ]})
    monkeypatch.setattr(ai, "_call_structured", lambda *args: output)
    items = turn(session, item()["quote"])["memory"]
    assert {(x["key"], x["kind"]) for x in items} == {
        ("home.stated_goal", "fact"), ("home.date", "fact"), ("home.permission", "unknown"), ("home.risk", "inference"),
    }
    monkeypatch.setattr(ai, "_call_structured", lambda *args: (_ for _ in ()).throw(RuntimeError()))
    assert any(i.key == "sabbatical.stated_goal" for i in asyncio.run(extract("I want a sabbatical.")))


@pytest.mark.parametrize("reply", ["around 80000 francs", "about 80000", "around 80000 (francs)", "80k", "CHF 80'000"])
def test_offline_amount_phrasings(reply):
    [item] = offline(reply, {"key": "sabbatical.amount"})
    assert (item.key, item.value, item.quote, item.dimension) == ("sabbatical.amount", 80000, reply, "goals")


@pytest.mark.parametrize(("reply", "expected"), [
    ("by March 2029", "2029-03"), ("in March 2029", "2029-03"), ("spring 2029", "2029"),
])
def test_offline_deadline_phrasings(reply, expected):
    [item] = offline(reply, {"key": "sabbatical.date"})
    assert (item.key, item.value) == ("sabbatical.date", expected)


@pytest.mark.parametrize(("reply", "expected"), [
    ("I'd delay it.", "delay"), ("I would postpone it.", "delay"), ("I'd lower the target.", "lower"),
    ("I'd reduce it.", "lower"), ("I'd consider both.", "both"), ("I would postpone rather than reduce.", "delay"),
])
def test_offline_flexibility_phrasings(reply, expected):
    [item] = offline(reply, {"key": "sabbatical.flexibility"})
    assert (item.key, item.value) == ("sabbatical.flexibility", expected)


def test_goal_draft_requires_confirmed_complete_goal_and_no_mutation(session):
    turn(session, "I want a sabbatical with CHF 15k in May 2028")
    with pytest.raises(ValueError, match="confirmed"):
        execute_tool("propose_changes", {"from_confirmed_goals": True}, session)
    for observation in session.memory.items("B"):
        session.memory.resolve("B", observation["id"], "confirmed")
    result = execute_tool("propose_changes", {"from_confirmed_goals": True}, session)
    [change] = result["draft_changes"]
    assert change["path"] == "people.B.goals"
    [goal] = change["value"]
    assert (goal["target_chf"], goal["target_date"]) == (15000, "2028-05")
    assert session.plan.person("B").goals == []


def test_tools_and_grounding_match_engine(session, caplog):
    before = evaluate(session.plan)
    result = execute_tool("get_summary", {}, session)
    assert result["people"][0]["min_cash"] == before["people"][1]["min_cash"]
    assert ground_turn(session, result["speakable"])
    assert not ground_turn(session, "You have CHF 9,876,543.")
    assert "9,876,543" not in caplog.text
    flag = asyncio.run(ingest_turn(session, "assistant", "You have CHF 9,876,543."))
    assert flag["grounded"] is False
    change = {"path": "people.B.income_monthly", "value": 5600}
    comparison = execute_tool("simulate_changes", {"changes": [change]}, session)
    actual = evaluate(apply_changes(session.plan, [Change(**change)]))
    assert comparison["after"]["people"][1]["min_cash"] == actual["people"][1]["min_cash"]
    assert execute_tool("list_recommendations", {}, session)["status"] == before["status"]
    with pytest.raises(ValueError, match="supported"):
        execute_tool("simulate_changes", {"changes": [{"path": "people.B.invalid", "value": 0}]}, session)
    with pytest.raises(ValidationError):
        execute_tool("get_summary", {"scope": "unknown"}, session)


def test_twin_routes_pair_session_and_viewer(session, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from converge import api
    from converge.store import Store

    monkeypatch.setattr(config, "STATE_DIR", tmp_path / "api-state")
    monkeypatch.setattr(api, "store", Store(path=str(tmp_path / "workspace.json"), seed_factory=lambda: session.plan))
    with TestClient(api.app) as client:
        assert client.post("/api/twin/session", json={"person": "nobody"}).status_code == 404
        sid = client.post("/api/twin/session", json={"person": "B"}).json()["session_id"]
        response = client.post("/api/twin/ingest", json={"session_id": sid, "speaker": "user", "text": item()["quote"]})
        assert response.status_code == 200
        [fact, _] = response.json()["memory"]
        assert client.get("/api/twin/memory", params={"person": "A"}).json() == {"memory": []}
        url = f"/api/twin/memory/{fact['id']}/confirm"
        assert client.post(url, json={"person": "A"}).status_code == 422
        assert client.post(url, json={"person": "B"}).status_code == 200
        assert client.post("/api/twin/tool", json={"session_id": sid, "name": "get_summary"}).status_code == 200
        assert client.delete("/api/twin/memory", params={"person": "B"}).json() == {"memory": []}
        assert client.post("/api/twin/tool", json={"session_id": sid, "name": "get_summary"}).status_code == 422


def test_hypothetical_goals_are_simulated_before_confirmation_but_not_draftable(session):
    goals = [Goal(id="new", name="Trip", target_chf=1000, target_date="2027-06").model_dump()]
    outcome = execute_tool("simulate_changes", {"changes": [{"path": "people.B.goals", "value": goals}]}, session)
    assert outcome["after"]["people"][1]["goals"][0]["name"] == "Trip"
    assert "draft_changes" not in outcome


def test_confirmed_goal_updates_existing_goal_without_double_reserving_cash(session):
    goal = Goal(id="existing", name="Sabbatical", target_chf=9000, target_date="2027-01", measure="liquid")
    session.plan = apply_changes(session.plan, [Change(path="people.B.goals", value=[goal.model_dump()])])
    turn(session, "I want a sabbatical with CHF 15k in May 2028")
    for observation in session.memory.items("B"):
        session.memory.resolve("B", observation["id"], "confirmed")
    changes = execute_tool("propose_changes", {"from_confirmed_goals": True}, session)["draft_changes"]
    [updated] = changes[0]["value"]
    assert updated["id"] == "existing" and updated["measure"] == "liquid"
    assert (updated["target_chf"], updated["target_date"]) == (15000, "2028-05")


def test_gaps_reports_facts_unknowns_profile_and_skips(session):
    turn(session, "I want a sabbatical with CHF 15k in spring 2028")
    turn(session, "I prefer not to say.")
    latest = session.memory.last_user(session.id)
    session.memory.save(session.id, latest["id"], [Item.model_validate(item(
        key="skip.constraints", dimension="risk_flexibility", value="opted out", quote=latest["text"]))])
    gaps = execute_tool("get_gaps", {}, session)
    assert set(gaps["dimensions"]) == {"goals", "priorities", "timelines", "feasibility", "risk_flexibility"}
    assert not any(key in gaps for key in ["question", "reaction", "prompt"])
    assert gaps["means_without_confirmed_objective"] == ["sabbatical"]
    assert "constraints" in gaps["skipped_topics"] and "unspecified" in gaps["skipped_topics"]
    assert "income" in gaps["known_from_profile"]["topics"]
    goal = gaps["goals"]["sabbatical"]
    assert "constraints" not in goal["unknown_fields"]
    assert {"date", "underlying_objective", "simulation"} <= set(goal["unknown_fields"])


def test_objective_requires_confirmation_in_the_users_own_words(session):
    turn(session, "I want a sabbatical.")
    text = "I think I'd like a bit more time with my kids."
    turn(session, text)
    objective = item(key="sabbatical.underlying_objective", value="more time with my kids", quote=text)
    saved = execute_tool("save_memory", {"items": [objective, objective | {"kind": "inference"}]}, session)["memory"]
    pending = next(i for i in saved if i["key"] == objective["key"])
    assert pending["kind"] == "inference" and pending["status"] == "pending"
    with pytest.raises(ValueError):
        session.memory.resolve("B", pending["id"], "confirmed")
    turn(session, "Yes, I want more time with my kids.")
    confirmed = execute_tool("save_memory", {"items": [objective | {"quote": "more time with my kids"}]}, session)
    matching = [i for i in confirmed["memory"] if i["key"] == objective["key"] and i["status"] == "confirmed"]
    assert len(matching) == 1 and matching[0]["kind"] == "fact"
    assert execute_tool("get_gaps", {}, session)["means_without_confirmed_objective"] == []


def test_compare_paths_identical_start_does_not_report_trivial_break_even(session):
    change = {"path": "people.B.income_steps", "value": [
        {"id": "raise", "label": "Expected net pay change", "start": "2027-04", "monthly_chf_delta": 1000},
    ]}
    inputs = [{"name": "baseline", "changes": []}, {"name": "alternative", "changes": [change]}]
    actual = execute_tool("compare_paths", {"paths": inputs}, session)
    for path, definition in zip(actual["paths"], inputs):
        expected = evaluate(apply_changes(session.plan, [Change(**ch) for ch in definition["changes"]]))
        assert path["verdict"] == expected["status"]
        assert path["assumptions"]["value"] == [Change(**ch).model_dump() for ch in definition["changes"]]
        assert [p["end_net_worth"] for p in path["people"]] == [p["end_net_worth"] for p in expected["people"]]
        assert [p["min_cash"] for p in path["people"]] == [p["min_cash"] for p in expected["people"]]
        assert [p["goals"] for p in path["people"]] == [p["goals"] for p in expected["people"]]
    above = next(x for x in actual["overtakes"] if x["path"] == "alternative")
    below = next(x for x in actual["overtakes"] if x["path"] == "baseline")
    assert above["break_even_month"] is None and above["status"] == "never behind"
    assert above["max_deficit_chf"] is None and ground_turn(session, above["speakable"])
    assert below["break_even_month"] is None and below["status"] == "does not catch up"
    assert "does not catch up by Dec 2036" in below["speakable"]
    assert not session.plan.person("B").income_steps


def test_compare_paths_break_even_requires_staying_at_or_above(session):
    steps = [
        {"id": f"step-{i}", "label": "Pay change", "start": f"2027-{i:02}", "monthly_chf_delta": delta}
        for i, delta in enumerate((-100, 200, -300, 400), start=1)
    ]
    result = execute_tool("compare_paths", {"paths": [
        {"name": "baseline", "changes": []},
        {"name": "alternative", "changes": [{"path": "people.B.income_steps", "value": steps}]},
    ]}, session)
    alternative = result["overtakes"][1]
    assert alternative["break_even_month"] == "2027-04"
    assert alternative["max_deficit_month"] == "2027-03"
    assert alternative["max_deficit_chf"] == 200


@pytest.fixture
def emil_paths():
    def income_step(label, start, delta):
        return {"path": "people.P00809.income_steps", "value": [
            {"id": "raise", "label": label, "start": start, "monthly_chf_delta": delta},
        ]}

    return [
        {"name": "Switch", "changes": [income_step("Switch jobs", "2028-07", 500)]},
        {"name": "Master's", "changes": [
            {"path": "people.P00809.career_breaks", "value": [
                {"id": "study", "label": "Study", "start": "2028-01", "months": 12,
                 "income_pct": 50, "one_off_cost_chf": 12000},
            ]},
            income_step("Post-degree raise", "2029-01", 2000),
        ]},
    ]


def test_compare_paths_emil_matches_separate_runs(session, emil_paths):
    plan = default_plan(("P00918", "P00809"))
    session = Session(session.memory, session.memory.start("P00809"), plan)
    original = plan.model_dump()
    normal_before = evaluate(plan)
    actual = execute_tool("compare_paths", {"paths": emil_paths}, session)
    # Main plans over 120 months already, so the default and comparison windows coincide.
    assert (actual["default_end_month"], actual["extended_end_month"]) == ("2036-12", "2036-12")
    assert actual["extrapolation"] is None
    default_runs, extended_runs = [], []
    for path, inputs in zip(actual["paths"], emil_paths):
        scenario = apply_changes(plan, [Change(**ch) for ch in inputs["changes"]])
        default_runs.append(evaluate(scenario)["household"]["net_worth"])
        scenario.assumptions.horizon_months = 120
        extended_runs.append(evaluate(scenario)["household"]["net_worth"])
        assert path["end_household_net_worth"] == default_runs[-1][-1]
        assert path["extended_end_household_net_worth"] == extended_runs[-1][-1]
        assert "less certain" not in path["speakable"]

    switch, masters = actual["overtakes"]
    default_gap = round(default_runs[1][-1] - default_runs[0][-1], 2)
    extended_gaps = [round(m - s, 2) for s, m in zip(*extended_runs)]
    assert masters["default_end_gap_chf"] == default_gap == extended_gaps[-1]
    assert masters["extended_end_gap_chf"] == extended_gaps[-1] == pytest.approx(70000, abs=200)
    assert masters["break_even_month"] == "2033-02"
    assert masters["max_deficit_month"] == "2028-12"
    assert masters["max_deficit_chf"] == -min(extended_gaps)
    assert masters["end_monthly_difference_chf"] == extended_gaps[-1] - extended_gaps[-2] == 1500
    assert switch["break_even_month"] is None
    assert switch["extended_end_gap_chf"] == -masters["extended_end_gap_chf"]
    assert "Feb 2033" in masters["speakable"] and ground_turn(session, masters["speakable"])
    assert plan.model_dump() == original and evaluate(plan) == normal_before


def test_ingest_flags_multiple_assistant_questions_without_blocking(session, caplog):
    text = "What matters to you? What would success look like?"
    result = asyncio.run(ingest_turn(session, "assistant", text))
    assert result["grounded"] is True and result["multiple_questions"] is True
    assert session.memory.recent_turns(session.id)[-1]["text"] == text
    assert "multiple question marks" in caplog.text
    assert turn(session, "What if I switch jobs? Could it work?")["multiple_questions"] is False


def test_profile_provenance_for_ledger_figures_and_estimates(session):
    read = lambda topic: execute_tool("get_profile", {"person": "Ben", "topic": topic}, session)
    grocery = next(c for c in read("spending")["categories"] if c["key"] == "groceries")
    assert grocery["observed_chf_monthly"] == {"value": 400.0, "provenance": "historical UBS data"}
    assert grocery["budget_chf_monthly"]["provenance"] == "plan assumption"
    assert read("income")["planned_net_chf_monthly"]["provenance"] == "plan assumption"
    assert read("savings_rate")["cash_savings_rate_pct"]["provenance"] == "simulated"
    assert read("balances")["opening_cash"]["provenance"] == "historical UBS data"
    assert read("debts")["opening_liabilities"]["provenance"] == "historical UBS data"
    assert read("goals")["outcomes"]["provenance"] == "simulated"
    assert read("events")["plan_events"]["provenance"] == "plan assumption"


def test_shared_home_profile_compares_configured_purchase_to_current_plan(session):
    result = execute_tool("get_summary", {"scope": "together"}, session)
    assert result["home"] is None
    preview = result["configured_home_preview"]
    engine = evaluate(apply_changes(session.plan, [Change(path="shared.property.enabled", value=True)]))
    assert preview["home"]["affordability"]["passes"] == engine["property"]["affordability"]["passes"]
    assert preview["home"]["affordability"]["ratio_pct"] == round(100 * engine["property"]["affordability"]["ratio"], 1)
    assert [p["headroom"] for p in preview["people"]] == [p["headroom"] for p in engine["people"]]
    assert [p["lowest_cash_change_chf"] for p in preview["people"]] == [
        round(x["min_cash"] - y["min_cash"], 2) for x, y in zip(preview["people"], result["people"])
    ]


def test_gaps_associates_masters_alias_with_its_confirmed_objective(session):
    turn(session, "I want to do a master's.")
    text = "Yes, my objective is a better-paid job."
    turn(session, text)
    observation = item(key="master_degree.underlying_objective", quote="a better-paid job", value="a better-paid job")
    execute_tool("save_memory", {"items": [observation]}, session)
    gaps = execute_tool("get_gaps", {}, session)
    assert gaps["goals"]["masters"]["confirmed_underlying_objective"] == "a better-paid job"
    assert gaps["means_without_confirmed_objective"] == []
