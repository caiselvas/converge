"""Person-scoped discovery state. The database contains text and JSON only."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Literal
from uuid import uuid4

from pydantic import Field, model_validator

from converge.ai import StructuredOutput

Dimension = Literal["goals", "priorities", "timelines", "feasibility", "risk_flexibility"]
Kind = Literal["fact", "inference", "unknown"]


class Item(StructuredOutput):
    dimension: Dimension
    key: str = Field(pattern=r"^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)?$", max_length=80)
    value: str | float | None
    kind: Kind
    confidence: float = Field(ge=0, le=1)
    quote: str | None
    why: str | None

    @model_validator(mode="after")
    def evidence(self):
        if self.kind == "unknown":
            if self.value is not None or not self.why or self.quote is not None:
                raise ValueError("unknowns require a reason and no value or quote")
        elif self.value is None or (self.kind == "fact" and not self.quote):
            raise ValueError("known items need a value and facts need a quote")
        return self


class Memory:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS sessions(
                    id TEXT PRIMARY KEY, person_id TEXT NOT NULL,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch()), expires_at INTEGER
                );
                CREATE TABLE IF NOT EXISTS utterances(
                    id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions ON DELETE CASCADE,
                    speaker TEXT NOT NULL CHECK(speaker IN ('user', 'assistant')), text TEXT NOT NULL,
                    ts INTEGER NOT NULL DEFAULT (unixepoch()), flagged INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS memory_items(
                    id INTEGER PRIMARY KEY, person_id TEXT NOT NULL, dimension TEXT NOT NULL, key TEXT NOT NULL,
                    value TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('fact', 'inference', 'unknown')),
                    confidence REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
                    evidence_utterance_id INTEGER REFERENCES utterances ON DELETE CASCADE,
                    quote TEXT, why TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                    UNIQUE(person_id, dimension, key, value, kind)
                );
                CREATE TABLE IF NOT EXISTS questions(
                    session_id TEXT NOT NULL REFERENCES sessions ON DELETE CASCADE, turn INTEGER NOT NULL,
                    key TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(session_id, turn)
                );
                CREATE TABLE IF NOT EXISTS tool_results(
                    id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions ON DELETE CASCADE,
                    facts TEXT NOT NULL
                );
            """)

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA secure_delete=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def start(self, person: str, expires: int | None = None) -> str:
        session = uuid4().hex
        with self.db() as db:
            db.execute("INSERT INTO sessions(id, person_id, expires_at) VALUES(?, ?, ?)", (session, person, expires))
        return session

    def person(self, session: str) -> str:
        with self.db() as db:
            row = db.execute("""SELECT person_id FROM sessions
                WHERE id=? AND (expires_at IS NULL OR expires_at >= unixepoch())""", (session,)).fetchone()
        if row is None:
            raise ValueError("Discovery session is unavailable. Start a new session.")
        return row["person_id"]

    def add_turn(self, session: str, speaker: str, text: str, flagged: bool = False) -> int:
        with self.db() as db:
            return db.execute("INSERT INTO utterances(session_id,speaker,text,flagged) VALUES(?,?,?,?)",
                              (session, speaker, text, flagged)).lastrowid

    def last_user(self, session: str):
        with self.db() as db:
            return db.execute("""SELECT id, text FROM utterances WHERE session_id=? AND speaker='user'
                ORDER BY id DESC LIMIT 1""", (session,)).fetchone()

    def user_count(self, session: str) -> int:
        with self.db() as db:
            return db.execute("SELECT count(*) FROM utterances WHERE session_id=? AND speaker='user'", (session,)).fetchone()[0]

    def save(self, session: str, evidence: int | None, items: list[Item], question: dict | None = None) -> list[dict]:
        from converge.voice.extract import supported_fact

        person = self.person(session)
        with self.db() as db:
            row = db.execute("SELECT text FROM utterances WHERE id=? AND session_id=? AND speaker='user'",
                             (evidence, session)).fetchone()
            for item in items:
                if item.kind != "unknown" and row is None:
                    continue
                if item.quote and (row is None or item.quote not in row["text"]):
                    continue
                if item.kind == "fact" and not supported_fact(item, row["text"], question):
                    continue
                db.execute("""INSERT OR IGNORE INTO memory_items(person_id,dimension,key,value,kind,confidence,
                    evidence_utterance_id,quote,why) VALUES(?,?,?,?,?,?,?,?,?)""",
                           (person, item.dimension, item.key, json.dumps(item.value), item.kind,
                            item.confidence, evidence, item.quote, item.why))
        return self.items(person)

    def items(self, person: str) -> list[dict]:
        with self.db() as db:
            rows = db.execute("SELECT * FROM memory_items WHERE person_id=? ORDER BY id", (person,)).fetchall()
        return [dict(row) | {"value": json.loads(row["value"])} for row in rows]

    def resolve(self, person: str, item_id: int, status: Literal["confirmed", "rejected"]) -> list[dict]:
        with self.db() as db:
            n = db.execute("""UPDATE memory_items SET status=? WHERE person_id=? AND id=?
                AND (kind!='unknown' OR ?='rejected')""", (status, person, item_id, status)).rowcount
        if not n:
            raise ValueError("Memory item cannot be updated for this viewer.")
        return self.items(person)

    def clear(self, person: str) -> None:
        with self.db() as db:
            db.execute("DELETE FROM memory_items WHERE person_id=?", (person,))
            db.execute("DELETE FROM sessions WHERE person_id=?", (person,))

    def question_history(self, session: str) -> list[tuple[int, dict]]:
        with self.db() as db:
            rows = db.execute("SELECT turn,result FROM questions WHERE session_id=? ORDER BY turn", (session,)).fetchall()
        return [(r["turn"], json.loads(r["result"])) for r in rows]

    def question(self, session: str, turn: int, result: dict):
        with self.db() as db:
            db.execute("INSERT OR IGNORE INTO questions VALUES(?,?,?,?)",
                       (session, turn, result["key"], json.dumps(result)))
            row = db.execute("SELECT result FROM questions WHERE session_id=? AND turn=?", (session, turn)).fetchone()
        return json.loads(row[0])

    def record_tool(self, session: str, result: dict):
        with self.db() as db:
            db.execute("INSERT INTO tool_results(session_id,facts) VALUES(?,?)", (session, json.dumps(result)))
            db.execute("""DELETE FROM tool_results WHERE session_id=? AND id NOT IN
                (SELECT id FROM tool_results WHERE session_id=? ORDER BY id DESC LIMIT 4)""", (session, session))

    def recent_tools(self, session: str) -> list[dict]:
        with self.db() as db:
            rows = db.execute("SELECT facts FROM tool_results WHERE session_id=? ORDER BY id DESC", (session,)).fetchall()
        return [json.loads(r[0]) for r in rows]
