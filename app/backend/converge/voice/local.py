"""Optional push-to-talk pipeline. Models and audio are never downloaded or persisted here."""
from __future__ import annotations

import asyncio
import json
import logging
import re
import wave
from array import array
from dataclasses import dataclass
from functools import lru_cache
from importlib.util import find_spec
from io import BytesIO
from pathlib import Path
from sys import byteorder
from threading import Lock
from time import time
from typing import Callable, Iterable
from urllib.parse import urlparse

import httpx
from fastapi import WebSocket, WebSocketDisconnect

from converge import config
from converge.engine.changes import apply_changes
from converge.engine.evaluate import chf
from converge.models import Change
from converge.voice.agent import chat_tools, run_tools
from converge.voice.extract import offline
from converge.voice.routes import ingest_turn, memory_db
from converge.voice.tools import Session, execute_tool, ground_turn

log = logging.getLogger(__name__)

SAMPLE_RATE = 16_000
LOCAL_MODEL_TIMEOUT = 150.0
LOCAL_TURN_TIMEOUT = 240.0
LOCAL_INTRO = "I'm Converge's AI coach. What goal would you like to explore?"
MOVE_IN_CASH_QUESTION = re.compile(
    r"(?:please )?simulate (?:us )?mov(?:e|ing) in together[.!?,]? "
    r"(?:and )?compare (?:our |the )?lowest (?:cash|cache)(?: balances?)? before and after(?: the change)?[.!?]?",
    re.IGNORECASE,
)
MAX_PCM = SAMPLE_RATE * 2 * 15
admitted: dict[str, int] = {}
admissions_lock = Lock()


def missing_dependencies() -> str | None:
    if not find_spec("faster_whisper") or not find_spec("piper"):
        return "Install the optional faster-whisper and Piper packages to use local voice."
    stt = config.LOCAL_STT_MODEL
    voice = config.LOCAL_TTS_MODEL
    if not stt or not (Path(stt) / "model.bin").is_file():
        return "Set CONVERGE_LOCAL_STT_MODEL to a downloaded faster-whisper model directory."
    if not voice or not Path(voice).is_file() or not Path(voice + ".json").is_file():
        return "Set CONVERGE_LOCAL_TTS_MODEL to a Piper .onnx file with its .onnx.json."
    url = urlparse(config.LOCAL_LLM_URL)
    if url.scheme not in {"http", "https"} or url.hostname not in {"localhost", "127.0.0.1", "::1"} or url.username:
        return "Local voice requires a loopback CONVERGE_LOCAL_LLM_URL."
    if not config.LOCAL_LLM_MODEL:
        return "Set CONVERGE_LOCAL_LLM_MODEL to a model loaded on the local server."
    return None


def admit(session_id: str, expires: int) -> None:
    with admissions_lock:
        for key in [key for key, deadline in admitted.items() if deadline <= time()]:
            del admitted[key]
        admitted[session_id] = expires


def take_admission(session_id: str) -> int:
    with admissions_lock:
        return admitted.pop(session_id, 0)


def voiced(pcm: bytes) -> bool:
    """Keep turns with at least one 20 ms frame above the silence floor."""
    samples = array("h")
    samples.frombytes(pcm[:len(pcm) // 2 * 2])
    if byteorder == "big":
        samples.byteswap()
    frame = SAMPLE_RATE // 50
    return any(sum(sample * sample for sample in window) > len(window) * 350 ** 2
               for start in range(0, len(samples), frame) if len(window := samples[start:start + frame]) == frame)


def wave_bytes(pcm: bytes, sample_rate: int) -> bytes:
    output = BytesIO()
    with wave.open(output, "wb") as writer:
        writer.setparams((1, 2, sample_rate, 0, "NONE", "not compressed"))
        writer.writeframes(pcm)
    return output.getvalue()


@dataclass(frozen=True)
class Pipeline:
    stt: Callable[[bytes], str]
    llm: Callable[[list[dict]], dict]
    tts: Callable[[str], Iterable[bytes]]


@lru_cache(maxsize=1)
def load_pipeline() -> Pipeline:
    import numpy as np
    from faster_whisper import WhisperModel
    from piper import PiperVoice

    stt = WhisperModel(config.LOCAL_STT_MODEL, device="cpu", compute_type="int8", local_files_only=True)
    tts = PiperVoice.load(config.LOCAL_TTS_MODEL, use_cuda=False)

    def transcribe(pcm: bytes) -> str:
        samples = np.frombuffer(pcm[:len(pcm) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0
        segments, _ = stt.transcribe(samples, beam_size=1, vad_filter=False)
        return " ".join(segment.text.strip() for segment in segments)

    def chat(messages: list[dict]) -> dict:
        with httpx.Client(timeout=httpx.Timeout(LOCAL_MODEL_TIMEOUT, connect=5.0), trust_env=False) as client:
            response = client.post(config.LOCAL_LLM_URL.rstrip("/") + "/chat/completions",
                                   json=dict(model=config.LOCAL_LLM_MODEL, messages=messages, tools=chat_tools(),
                                             max_tokens=300, temperature=0))
            response.raise_for_status()
            return response.json()["choices"][0]["message"]

    def speak(text: str):
        for chunk in tts.synthesize(text):
            yield wave_bytes(chunk.audio_int16_bytes, chunk.sample_rate)

    return Pipeline(transcribe, chat, speak)


async def say(session: Session, text: str, pipeline: Pipeline, send) -> None:
    result = await ingest_turn(session, "assistant", text)
    await send({"type": "transcript", "speaker": "assistant", "text": text, "grounded": result["grounded"],
                "memory": result["memory"]})
    await send({"type": "state", "state": "speaking"})
    frames = iter(pipeline.tts(text))
    while (frame := await asyncio.to_thread(next, frames, None)) is not None:
        await send(frame)
    await send({"type": "state", "state": "listening"})


async def run_turn(session: Session, pcm: bytes, pipeline: Pipeline, send, history: list[dict]) -> None:
    if not voiced(pcm):
        await send({"type": "state", "state": "listening"})
        return
    await send({"type": "state", "state": "thinking"})
    text = (await asyncio.to_thread(pipeline.stt, pcm)).strip()[:4000]
    if not text:
        await send({"type": "state", "state": "listening"})
        return
    evidence = session.memory.add_turn(session.id, "user", text)
    session.memory.save(session.id, evidence, offline(text))
    await send({"type": "transcript", "speaker": "user", "text": text})
    if MOVE_IN_CASH_QUESTION.fullmatch(text):
        # This explicit what-if has one unambiguous lever and no new assumptions.
        # Use the plan's existing move-in date and costs.
        result = await asyncio.to_thread(
            execute_tool, "simulate_changes",
            {"changes": [{"path": "shared.household.enabled", "value": True}]}, session,
        )
        before = min(result["before"]["people"], key=lambda person: person["min_cash"])
        after = min(result["after"]["people"], key=lambda person: person["min_cash"])
        answer = (
            f"Using the plan's move-in date and costs, the lowest individual cash balance in the simulation "
            f"is {chf(before['min_cash'])} for {before['name']} before the change "
            f"and {chf(after['min_cash'])} for {after['name']} after moving in together."
        )
        remember_reply(history, text, answer)
        await say(session, answer, pipeline, send)
        return
    await respond(session, text, pipeline, send, history)


def remember_reply(history: list[dict], text: str, answer: str) -> None:
    history.append({"role": "user", "content": text})
    history.append({"role": "assistant", "content": answer})
    del history[:-8]


async def respond(session: Session, text: str, pipeline: Pipeline, send, history: list[dict]) -> None:
    from converge.voice.realtime import INSTRUCTIONS

    messages = [{"role": "system", "content": INSTRUCTIONS + "\nKeep spoken replies to two short sentences."},
                *history[-8:], {"role": "user", "content": text}]
    async def on_tool(name, result):
        if result.get("draft_changes"):
            await send({"type": "draft", "draft_changes": result["draft_changes"]})
        comparison = result if name in {"compare_study", "explore_what_if"} and "scenario" in result else result.get("comparison")
        if comparison:
            await send({"type": "comparison", "result": comparison})

    answer = await run_tools(session, messages, lambda history: asyncio.to_thread(pipeline.llm, history), on_tool)
    if not ground_turn(session, answer):
        answer = "I couldn't verify the figures against the simulation. Which part should I check again?"
    remember_reply(history, text, answer)
    await say(session, answer, pipeline, send)


async def serve_socket(socket: WebSocket, session_id: str, get_plan) -> None:
    reason = missing_dependencies() if config.VOICE_PROVIDER == "local" else "Local voice is turned off."
    expires = take_admission(session_id) if reason is None else 0
    if reason or expires <= time():
        await socket.close(code=1008, reason=reason or "Local voice session expired.")
        return
    await socket.accept()
    memory = memory_db()
    history = []
    pcm = bytearray()
    draft = []
    recording = False

    async def send(value):
        if isinstance(value, bytes):
            await socket.send_bytes(value)
        else:
            await socket.send_json(value)

    try:
        pipeline = await asyncio.wait_for(asyncio.to_thread(load_pipeline), timeout=max(0.1, expires - time()))
        session = Session(memory, session_id, get_plan())
        await asyncio.wait_for(say(session, LOCAL_INTRO, pipeline, send), timeout=max(0.1, expires - time()))
        history.append({"role": "assistant", "content": LOCAL_INTRO})
        deadline = min(expires, time() + config.VOICE_IDLE_SECONDS)
        while time() < deadline:
            event = await asyncio.wait_for(socket.receive(), timeout=max(0.1, deadline - time()))
            if event["type"] == "websocket.disconnect":
                return
            if event.get("bytes") is not None:
                if recording:
                    pcm.extend(event["bytes"])
                    if len(pcm) > MAX_PCM:
                        await socket.close(code=1009, reason="Local turn exceeds fifteen seconds.")
                        return
                continue
            command = json.loads(event.get("text") or "{}")
            if command.get("type") == "playback" and not recording:
                deadline = min(expires, time() + config.VOICE_IDLE_SECONDS)
            elif command.get("type") == "start":
                if recording:
                    continue
                raw = command.get("draft") or []
                if not isinstance(raw, list) or len(raw) > 200:
                    raise ValueError("Local draft is too large.")
                draft = [Change.model_validate(ch) for ch in raw]
                pcm.clear()
                recording = True
                deadline = min(expires, time() + config.VOICE_IDLE_SECONDS)
            elif command.get("type") == "end" and recording:
                recording = False
                plan = get_plan()
                session = Session(memory, session_id, apply_changes(plan, draft) if draft else plan)
                await asyncio.wait_for(run_turn(session, bytes(pcm), pipeline, send, history),
                                       timeout=min(LOCAL_TURN_TIMEOUT, max(0.1, expires - time())))
                pcm.clear()
                deadline = min(expires, time() + config.VOICE_IDLE_SECONDS)
        await socket.close(code=1000)
    except WebSocketDisconnect:
        return
    except (asyncio.TimeoutError, httpx.TimeoutException):
        await socket.close(code=1000, reason="Local voice timed out.")
    except Exception as error:
        log.warning("Local voice failed (%s)", type(error).__name__)
        await send({"type": "error", "message": "Local voice could not process the turn. Check its models and local server."})
        await socket.close(code=1011)
