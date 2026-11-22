"""Text discovery endpoints, also used by both voice transports."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import Field

from converge import config
from converge.ai import StructuredOutput
from converge.engine.changes import apply_changes
from converge.models import Change
from converge.voice.extract import extract
from converge.voice.memory import Memory
from converge.voice.tools import Session, execute_tool, ground_turn


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


async def ingest_turn(session: Session, speaker: str, text: str) -> dict:
    person = session.person_id
    text = text.strip()
    if not text:
        raise ValueError("Transcript is empty.")
    grounded = ground_turn(session, text) if speaker == "assistant" else True
    last_question = session.last_question
    evidence = session.memory.add_turn(session.id, speaker, text, not grounded)
    items = session.memory.items(person)
    if speaker == "user":
        items = session.memory.save(session.id, evidence, await extract(text, last_question), last_question)
    return dict(memory=items, grounded=grounded)


def router_for(get_plan):
    router = APIRouter()

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

    return router
