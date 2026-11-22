import json
from struct import pack
from unittest.mock import Mock

from fastapi.testclient import TestClient

from converge import api, config
from converge.engine.evaluate import evaluate
from converge.store import Store
from converge.voice import local, realtime


def test_local_mode_without_optional_packages(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "VOICE_PROVIDER", "local")
    monkeypatch.setattr(local, "find_spec", lambda _: None)
    assert realtime.provider_status() == {
        "provider": "local", "enabled": False,
        "reason": "Install the optional faster-whisper and Piper packages to use local voice.",
    }


def test_local_socket_stt_tool_llm_tts_and_text_memory(simple_plan, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "STATE_DIR", tmp_path)
    monkeypatch.setattr(config, "VOICE_PROVIDER", "local")
    monkeypatch.setattr(local, "missing_dependencies", lambda: None)
    monkeypatch.setattr(api, "store", Store(path=str(tmp_path / "workspace.json"), seed_factory=lambda: simple_plan))
    monkeypatch.setattr(realtime, "limit", realtime.SessionLimit())
    monkeypatch.setattr(realtime, "mint_client_secret", Mock(side_effect=AssertionError("Local mode contacted hosted voice.")))
    expected = evaluate(simple_plan)["people"][0]["min_cash"]
    answer = f"In this simulation, your lowest cash is CHF {expected:,.0f}."
    keyframes = [b"first-wave", b"second-wave"]

    def llm(messages):
        if messages[-1]["role"] != "tool":
            return {"tool_calls": [{"id": "check", "function": {"name": "get_summary", "arguments": "{}"}}]}
        facts = json.loads(messages[-1]["content"])
        assert facts["people"][0]["min_cash"] == expected
        return {"content": answer}

    pcm = pack("<320h", *([1200] * 320))
    stt = Mock(return_value="I want a sabbatical in May 2028.")
    pipeline = local.Pipeline(stt, llm, lambda text: iter(keyframes) if text == answer else iter(()))
    monkeypatch.setattr(local, "load_pipeline", lambda: pipeline)
    with TestClient(api.app) as client:
        session = client.post("/api/voice/session", json={"person": "A"}).json()
        assert "token" not in session
        with client.websocket_connect(session["socket_path"]) as socket:
            greeting = socket.receive_json()["text"]
            assert "AI discovery assistant" in greeting and "Over the next five years" in greeting
            assert socket.receive_json()["state"] == "speaking"
            assert socket.receive_json()["state"] == "listening"
            socket.send_json({"type": "start"})
            socket.send_bytes(bytes(len(pcm)))
            socket.send_json({"type": "end"})
            assert socket.receive_json()["state"] == "listening"
            stt.assert_not_called()

            socket.send_json({"type": "start"})
            socket.send_bytes(pcm)
            socket.send_json({"type": "end"})
            assert socket.receive_json()["state"] == "thinking"
            assert socket.receive_json()["speaker"] == "user"
            result = socket.receive_json()
            assert result["speaker"] == "assistant" and result["grounded"] is True
            assert any(item["key"] == "sabbatical" for item in result["memory"])
            assert socket.receive_json()["state"] == "speaking"
            assert [socket.receive_bytes(), socket.receive_bytes()] == keyframes
            assert socket.receive_json()["state"] == "listening"
        memory = client.get("/api/twin/memory", params={"person": "A"}).json()["memory"]
        assert any(item["quote"] == stt.return_value for item in memory)
    stt.assert_called_once_with(pcm)
    assert set(local.memory_db().path.parent.glob("*.wav")) == set()
