from unittest.mock import Mock

import httpx
import pytest
from fastapi.testclient import TestClient

from converge import api, config
from converge.engine.evaluate import evaluate
from converge.models import CareerBreak
from converge.store import Store
from converge.voice import realtime, routes


@pytest.fixture
def voice_api(monkeypatch, tmp_path, simple_plan):
    monkeypatch.setattr(api, "store", Store(path=str(tmp_path / "workspace.json"), seed_factory=lambda: simple_plan))
    monkeypatch.setattr(config, "STATE_DIR", tmp_path)
    monkeypatch.setattr(config, "VOICE_PROVIDER", "openai_realtime")
    monkeypatch.setattr(config, "OPENAI_API_KEY", "fake-server-key")
    monkeypatch.setattr(realtime, "limit", realtime.SessionLimit())
    with TestClient(api.app) as client:
        yield client


def test_mint_contract_and_cache_control(voice_api, monkeypatch):
    post = Mock(return_value=httpx.Response(200, json={"value": "fake-ephemeral", "expires_at": 9999999999}))
    monkeypatch.setattr(realtime.httpx, "post", post)
    response = voice_api.post("/api/voice/session", json={"person": "A"})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    data = response.json()
    assert data["token"] == "fake-ephemeral" and "fake-server-key" not in response.text
    assert data["idle_seconds"] == 30 and data["model"] == realtime.MODEL
    assert post.call_args.args == (realtime.SECRET_ENDPOINT,)
    request = post.call_args.kwargs["json"]
    assert request["expires_after"]["seconds"] == 30
    assert request["session"]["audio"]["input"]["turn_detection"]["create_response"] is False
    assert {t["name"] for t in request["session"]["tools"]} == {
        "get_summary", "simulate_changes", "list_recommendations", "propose_changes", "save_memory",
        "get_gaps", "get_profile", "compare_paths", "education_programs", "explore_what_if", "compare_study",
    }


@pytest.mark.parametrize(("provider", "key"), [("off", "fake"), ("openai_realtime", "")])
def test_disabled_states_never_mint(voice_api, monkeypatch, provider, key):
    monkeypatch.setattr(config, "VOICE_PROVIDER", provider)
    monkeypatch.setattr(config, "OPENAI_API_KEY", key)
    mock = Mock()
    monkeypatch.setattr(realtime.httpx, "post", mock)
    assert voice_api.get("/api/voice/status").json()["enabled"] is False
    assert voice_api.post("/api/voice/session", json={"person": "A"}).status_code == 503
    mock.assert_not_called()


def test_rate_limit_and_bad_provider_reply(voice_api, monkeypatch):
    post = Mock(return_value=httpx.Response(429, text="sensitive upstream response"))
    monkeypatch.setattr(realtime.httpx, "post", post)
    for _ in range(10):
        response = voice_api.post("/api/voice/session", json={"person": "A"})
        assert response.status_code == 502 and "sensitive upstream" not in response.text
    assert voice_api.post("/api/voice/session", json={"person": "A"}).status_code == 429
    assert post.call_count == 10
    limit = realtime.SessionLimit()
    assert all(limit.take(10) for _ in range(10))
    assert not limit.take(3609) and limit.take(3610)


def test_call_runs_study_against_existing_break_and_updates_answered_inputs(voice_api, monkeypatch, simple_plan):
    async def extract_locally(_text, _context):
        return []

    monkeypatch.setattr(routes, "extract", extract_locally)
    plan = simple_plan
    plan.people[0].career_breaks = [CareerBreak(
        id="leave", label="Planned leave", start="2027-10", months=6, income_pct=20,
    )]
    session = voice_api.post("/api/twin/session", json={"person": "A"}).json()["session_id"]

    def say(text):
        reply = voice_api.post("/api/twin/ingest", json={
            "session_id": session, "speaker": "user", "text": text, "preview_study": True,
        })
        assert reply.status_code == 200
        return reply.json()

    first = say("I want to study Quantitative Finance in September 2027.")["study_preview"]
    assert first["checks_passed"]
    assert len(first["scenario"][0]["cash"]) == len(first["months"])
    assert first["inputs"]["study"]["income_pct"] == 30
    assert "take-home pay during study" in first["assumed_inputs"]
    assert first["inputs"]["study"]["replaced_breaks"] == [{"label": "Planned leave", "start": "2027-10", "months": 6}]
    assert first["baseline"][0]["minimum_cash"] == evaluate(plan)["people"][0]["min_cash"]

    second = say("Fifty percent.")["study_preview"]
    assert second["inputs"]["study"]["start"] == "2027-09"
    assert second["inputs"]["study"]["income_pct"] == 50
    assert "take-home pay during study" not in second["assumed_inputs"]
    assert second["baseline"] == first["baseline"]
    assert "study_preview" not in say("What if we buy a house together?")
    assert voice_api.get("/api/workspace").json()["plan"]["people"][0]["career_breaks"][0]["id"] == "leave"
