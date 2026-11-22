from unittest.mock import Mock

import httpx
import pytest
from fastapi.testclient import TestClient

from converge import api, config
from converge.store import Store
from converge.voice import realtime


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
        "get_gaps", "get_profile", "compare_paths", "education_programs", "explore_what_if",
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
