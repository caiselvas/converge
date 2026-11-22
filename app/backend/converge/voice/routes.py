"""Text discovery endpoints, also used by both voice transports."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import Field

from converge import config
from converge.ai import StructuredOutput
from converge.engine.changes import apply_changes
from converge.engine.evaluate import chf
from converge.engine.what_if import PROGRAMS
from converge.models import Change
from converge.voice.agent import complete, provider, run_tools
from converge.voice.extract import extract, offline
from converge.voice.memory import Memory
from converge.voice.tools import Session, execute_tool, ground_turn

log = logging.getLogger(__name__)
STUDY = re.compile(r"\b(?:master(?:['’]s|s)?|study|studying|postgrad(?:uate)?|fine arts|quant(?:itative)? finance)\b", re.I)


def study_followup(history: list[dict]) -> str | None:
    text = " ".join(turn["content"] for turn in history if turn["role"] == "user")
    if not STUDY.search(text):
        return None
    programmes = [p for key, p in PROGRAMS.items() if re.search(key.replace("_", " ").replace("quant ", r"quant(?:itative)? "), text, re.I)]
    if len(programmes) != 1:
        return ("A master’s can affect both tuition and the income you keep while studying. "
                "Which programme are you considering?")
    programme = programmes[0]
    details = (f"The published {programme['label']} takes {programme['semesters']} semesters "
               f"at {chf(programme['semester_fee_chf'])} per semester.")
    if not re.search(r"\b20\d\d\b", text):
        return f"{details} When would you want to start?"
    return f"{details} How much of your usual take-home pay do you expect to keep while studying?"


def memory_db() -> Memory:
    return Memory(config.STATE_DIR / "voice.sqlite3")


class Viewer(StructuredOutput):
    person: str


class SessionBody(StructuredOutput):
    session_id: str


class Ingest(SessionBody):
    speaker: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=4000)


class ToolCall(SessionBody):
    name: str
    args: dict = Field(default_factory=dict)
    draft: list[Change] = Field(default_factory=list, max_length=200)


class ChatTurn(SessionBody):
    text: str = Field(min_length=1, max_length=4000)
    draft: list[Change] = Field(default_factory=list, max_length=200)


async def ingest_turn(session: Session, speaker: str, text: str, *, usage=None) -> dict:
    person = session.person_id
    text = text.strip()
    if not text:
        raise ValueError("Transcript is empty.")
    grounded = ground_turn(session, text) if speaker == "assistant" else True
    multiple_questions = speaker == "assistant" and text.count("?") >= 2
    if multiple_questions:
        log.warning("Discovery transcript had multiple question marks in an assistant turn")
    context = {"recent_turns": session.memory.recent_turns(session.id)}
    evidence = session.memory.add_turn(session.id, speaker, text, not grounded or multiple_questions)
    items = session.memory.items(person)
    if speaker == "user":
        context["goal_keys"] = [i["key"] for i in items if i["key"].endswith(".stated_goal") and i["status"] != "rejected"]
        extracted = await extract(text, context, **({"usage": usage} if usage is not None else {}))
        items = session.memory.save(session.id, evidence, extracted)
    return dict(memory=items, grounded=grounded, multiple_questions=multiple_questions)


def router_for(get_plan):
    router = APIRouter()
    active_chats: set[str] = set()

    def viewer(person: str):
        try:
            return get_plan().person(person)
        except KeyError:
            raise HTTPException(404, "Viewer is outside the demo workspace.") from None

    @router.post("/api/twin/session")
    def start(body: Viewer):
        return dict(session_id=memory_db().start(viewer(body.person).id))

    @router.get("/api/twin/memory")
    def items(person: str):
        return dict(memory=memory_db().items(viewer(person).id))

    @router.delete("/api/twin/memory")
    def clear(person: str):
        memory_db().clear(viewer(person).id)
        return dict(memory=[])

    @router.post("/api/twin/memory/{item_id}/{action}")
    def resolve(item_id: int, action: Literal["confirm", "reject"], body: Viewer):
        try:
            return dict(memory=memory_db().resolve(viewer(body.person).id, item_id,
                                                  "confirmed" if action == "confirm" else "rejected"))
        except ValueError as error:
            raise HTTPException(422, str(error)) from None

    @router.post("/api/twin/ingest")
    async def ingest(body: Ingest):
        try:
            session = Session(memory_db(), body.session_id, get_plan())
            viewer(session.person_id)
            return await ingest_turn(session, body.speaker, body.text)
        except ValueError as error:
            raise HTTPException(422, str(error)) from None

    @router.post("/api/twin/tool")
    def tool(body: ToolCall):
        try:
            plan = apply_changes(get_plan(), body.draft) if body.draft else get_plan()
            session = Session(memory_db(), body.session_id, plan)
            viewer(session.person_id)
            return execute_tool(body.name, body.args, session)
        except ValueError as error:
            raise HTTPException(422, str(error)) from None

    @router.get("/api/twin/chat")
    def chat_status():
        selected = provider()
        return {"provider": selected.name if selected else None, "model": selected.model if selected else None}

    async def chat_turn(body: ChatTurn, emit=None):
        from converge.voice.realtime import INSTRUCTIONS

        selected = provider()
        if selected is None:
            raise HTTPException(503, "No finance agent is configured.")
        if body.session_id in active_chats:
            raise HTTPException(409, "This conversation is already processing a turn.")
        text = body.text.strip()
        if not text:
            raise HTTPException(422, "Enter a message.")
        active_chats.add(body.session_id)
        try:
            plan = get_plan()
            session = Session(memory_db(), body.session_id, apply_changes(plan, body.draft) if body.draft else plan)
            person = viewer(session.person_id)
            messages = [{"role": "system", "content": INSTRUCTIONS + (
                "\nYou are chatting with " + person.name + ". Never claim that a scenario is an agreed plan. "
                "Use plain text, short paragraphs, and at most one actionable follow-up question. "
                "Use engine amounts as provided or rounded to the nearest CHF. Use the provided deltas for comparisons. "
                "Avoid numbered lists and illustrative figures that haven't been simulated. "
                "When someone is considering a master's, ask for the programme if they haven't named it. "
                "For a named programme, use education_programs for tuition and duration, then ask for the first missing input "
                "among start month and take-home pay during study. A first exploratory question can be answered without any numbers."
            )}]
            messages.extend({"role": turn["speaker"], "content": turn["text"]}
                            for turn in session.memory.recent_turns(session.id, limit=16))
            messages.append({"role": "user", "content": text})
            evidence = session.memory.add_turn(session.id, "user", text)
            session.memory.save(session.id, evidence, offline(text))
            evidence_cards = []
            proposed = []
            engine_phrasing = []
            tool_id = 0

            def start_tool(name):
                nonlocal tool_id
                tool_id += 1
                if emit:
                    emit({"type": "tool", "id": tool_id, "name": name, "status": "running"})

            async def record(name, result):
                if emit:
                    emit({"type": "tool", "id": tool_id, "name": name, "status": "failed" if "error" in result else "done"})
                if name == "propose_changes" and result.get("draft_changes"):
                    proposed[:] = result["draft_changes"]
                comparison = result if name == "explore_what_if" and "scenario" in result else result.get("comparison")
                if comparison:
                    evidence_cards.append({key: value for key, value in comparison.items() if key != "draft_changes"})
                if isinstance(result.get("speakable"), str):
                    engine_phrasing.append(result["speakable"])
                if name == "compare_paths" and result.get("overtakes"):
                    engine_phrasing.append(result["overtakes"][0]["speakable"])

            local = selected.name == "local"
            async with httpx.AsyncClient(timeout=httpx.Timeout(150 if local else 45, connect=5), trust_env=not local) as client:
                async with asyncio.timeout(240 if local else 75):
                    reply = await run_tools(session, messages, lambda history: complete(client, selected, history), record, start_tool)
            if not ground_turn(session, reply):
                if evidence_cards:
                    question = ("Which assumption are you most open to changing: your study income or your living arrangement?"
                                if evidence_cards[-1]["inputs"].get("study") else
                                "Would you like to test a different rent or a different way of splitting costs?")
                    reply = f"{evidence_cards[-1]['speakable']}\n\n{question}"
                elif engine_phrasing:
                    reply = f"{engine_phrasing[-1]}\n\nWhich outcome should we look at next?"
                else:
                    reply = study_followup(messages) or (
                        "I need a bit more detail before I can run a reliable comparison. What change would you like to test?"
                    )
            session.memory.add_turn(session.id, "assistant", reply)
            return {"text": reply, "comparisons": evidence_cards[-3:], "draft_changes": proposed}
        except (httpx.HTTPError, TimeoutError, KeyError, TypeError, IndexError) as error:
            log.warning("Finance chat failed (%s, HTTP %s)", type(error).__name__,
                        error.response.status_code if isinstance(error, httpx.HTTPStatusError) else "-")
            raise HTTPException(502, "The finance agent could not complete this turn. Try again.") from None
        except ValueError as error:
            raise HTTPException(422, str(error)) from None
        finally:
            active_chats.discard(body.session_id)

    @router.post("/api/twin/chat")
    async def chat(body: ChatTurn):
        return await chat_turn(body)

    @router.post("/api/twin/chat/stream")
    async def chat_stream(body: ChatTurn):
        async def stream():
            queue: asyncio.Queue[dict | None] = asyncio.Queue()

            async def run():
                try:
                    queue.put_nowait({"type": "reply", **await chat_turn(body, queue.put_nowait)})
                except HTTPException as error:
                    queue.put_nowait({"type": "error", "message": str(error.detail)})
                except Exception:
                    log.exception("Finance chat stream failed")
                    queue.put_nowait({"type": "error", "message": "The finance agent could not complete this turn."})
                finally:
                    queue.put_nowait(None)

            task = asyncio.create_task(run())
            try:
                while (event := await queue.get()) is not None:
                    yield json.dumps(event, ensure_ascii=False) + "\n"
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

        return StreamingResponse(stream(), media_type="application/x-ndjson",
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    return router
