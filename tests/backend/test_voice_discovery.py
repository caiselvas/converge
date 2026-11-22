import asyncio

import pytest
from pydantic import ValidationError

from converge import ai, config
from converge.engine.changes import apply_changes
from converge.engine.evaluate import evaluate
from converge.models import Change, Goal
from converge.voice.extract import Candidates, extract
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


def test_question_order_cooldown_and_sensitive_skip(session):
    ask = lambda: execute_tool("next_question", {}, session)
    assert ask()["key"] == "discovery"
    turn(session, "I want to buy a home in 2029")
    assert ask()["key"] == "home.amount"
    assert ask()["key"] == "home.amount"
    turn(session, "I am not sure.")
    assert ask()["key"] != "home.amount"
    turn(session, "I still want to buy a home.")
    assert ask()["key"] == "home.amount"
    turn(session, "CHF 900k")
    assert ask()["key"] == "home.date"
    turn(session, "June 2029")
    assert ask()["key"] == "home.priority"
    turn(session, "High")
    assert ask()["key"] == "home.flexibility"
    turn(session, "Delay")
    assert ask()["key"] == "home.permission"
    turn(session, "Prefer not to say")
    assert ask()["key"] == "discovery"
    turn(session, "Anything else?")
    assert ask()["key"] != "home.risk"


def test_existing_profile_goal_skips_known_fields(session):
    session.plan = apply_changes(session.plan, [Change(path="people.B.goals", value=[
        Goal(id="s", name="Sabbatical", target_chf=20000, target_date="2028-02").model_dump()
    ])])
    turn(session, "I want a sabbatical.")
    q = execute_tool("next_question", {}, session)
    assert q["key"] == "sabbatical.flexibility"
    assert q["dimension"] == "risk_flexibility"


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
