import asyncio

import pytest
from pydantic import ValidationError

from converge import ai, config
from converge.engine.changes import apply_changes
from converge.engine.evaluate import chf, evaluate
from converge.models import Change, Goal
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
        ("home", "fact"), ("home.date", "fact"), ("home.permission", "unknown"), ("home.risk", "inference"),
    }
    monkeypatch.setattr(ai, "_call_structured", lambda *args: (_ for _ in ()).throw(RuntimeError()))
    assert any(i.key == "sabbatical" for i in asyncio.run(extract("I want a sabbatical.")))


def test_question_order_stays_current_and_skips_sensitive_topics(session):
    ask = lambda: execute_tool("next_question", {}, session)
    assert ask()["key"] == "life_priorities"
    turn(session, "I'm not sure.")
    assert ask()["key"] == "life_priorities"
    turn(session, "Prefer not to say")
    assert ask()["key"] == "discovery"
    turn(session, "I want to buy a home in 2029")
    assert ask()["key"] == "home.why"
    turn(session, "I'd like a stable place for our family.")
    assert ask()["key"] == "home.amount"
    for reply in ("I am not sure.", "Still thinking.", "I don't know."):
        turn(session, reply)
        assert ask()["key"] == "home.amount"
    turn(session, "CHF 900k")
    assert ask()["key"] == "home.date"
    turn(session, "Spring 2029")
    assert ask()["key"] == "home.date"
    turn(session, "By June 2029")
    result = ask()
    assert result["key"] == "home.flexibility" and result["reaction"]
    assert ask() == result
    turn(session, "I'd postpone rather than reduce it.")
    assert ask()["key"] == "home.partner_agreement"
    turn(session, "We would need to agree on the neighbourhood.")
    assert ask()["key"] == "home.priority"
    turn(session, "High priority.")
    assert ask()["key"] == "home.permission"
    turn(session, "Prefer not to say")
    assert ask()["key"] == "discovery"
    turn(session, "Anything else?")
    assert ask()["key"] == "discovery"
    memory = {i["key"]: i for i in session.memory.items("B") if i["kind"] == "fact"}
    assert memory["home.why"]["quote"] == "I'd like a stable place for our family."
    assert memory["home.partner_agreement"]["quote"] == "We would need to agree on the neighbourhood."


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


def test_two_goals_ask_which_comes_first_and_store_priority(session):
    ask = lambda: execute_tool("next_question", {}, session)
    assert ask()["key"] == "life_priorities"
    turn(session, "Time with my family.")
    assert ask()["key"] == "discovery"
    turn(session, "I want to buy a home.")
    assert ask()["key"] == "home.why"
    turn(session, "I also want to take a sabbatical.")
    assert ask()["key"] == "home.why"
    turn(session, "I want a place to settle down.")
    assert ask()["key"] == "sabbatical.why"
    turn(session, "I want time to recover.")
    question = ask()
    assert question["key"] == "goal_tradeoff"
    assert "Home" in question["question"] and "Sabbatical" in question["question"]
    turn(session, "Sabbatical comes first.")
    assert ask()["key"] != "goal_tradeoff"
    facts = {i["key"]: i["value"] for i in session.memory.items("B") if i["kind"] == "fact"}
    assert facts["sabbatical.priority"] == "high" and facts["home.priority"] == "low"


def test_complete_goal_simulates_once_and_reacts_with_engine_result(session, monkeypatch):
    from unittest.mock import Mock
    from converge.voice import tools

    spy = Mock(wraps=tools.execute_tool)
    monkeypatch.setattr(tools, "execute_tool", spy)
    assert execute_tool("next_question", {}, session)["key"] == "life_priorities"
    turn(session, "I want more time for family.")
    assert execute_tool("next_question", {}, session)["key"] == "discovery"
    turn(session, "I want a sabbatical with around 800000 in May 2028")
    question = execute_tool("next_question", {}, session)
    assert question["key"] == "sabbatical.flexibility"
    assert spy.call_count == 1 and spy.call_args.args[0] == "simulate_changes"
    args = spy.call_args.args[1]
    expected = evaluate(apply_changes(session.plan, [Change(**change) for change in args["changes"]]))
    [goal] = expected["people"][1]["goals"]
    assert question["reaction"] == next(result["after"]["speakable"] for result in session.memory.recent_tools(session.id) if "after" in result)
    assert chf(goal["shortfall_chf"]) in question["reaction"] and "May 2028" in question["reaction"]
    assert ground_turn(session, question["reaction"])
    assert execute_tool("next_question", {}, session) == question
    assert spy.call_count == 1 and not session.plan.person("B").goals


def test_existing_profile_goal_skips_known_fields(session):
    session.plan = apply_changes(session.plan, [Change(path="people.B.goals", value=[
        Goal(id="s", name="Sabbatical", target_chf=20000, target_date="2028-02").model_dump()
    ])])
    turn(session, "I want a sabbatical.")
    q = execute_tool("next_question", {}, session)
    assert q["key"] == "life_priorities"
    turn(session, "I want enough time for my family.")
    assert execute_tool("next_question", {}, session)["key"] == "sabbatical.why"
    turn(session, "I need time to reset.")
    q = execute_tool("next_question", {}, session)
    assert q["key"] == "sabbatical.flexibility" and q["reaction"]


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
