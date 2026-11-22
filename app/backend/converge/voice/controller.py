"""Deterministic selection of the next discovery question."""
from __future__ import annotations

from dataclasses import dataclass
import re

from converge.models import Plan
from converge.voice.memory import Dimension, Item, Memory

SKIP = re.compile(r"\b(prefer not to say|rather not|skip)\b", re.I)


@dataclass(frozen=True)
class Question:
    field: str
    dimension: Dimension
    prompt: str
    reason: str
    priority: int
    prerequisites: tuple[str, ...] = ()
    sensitive: bool = False
    cooldown: int = 2


CATALOGUE = (
    Question("amount", "feasibility", "How much would you like to set aside for {goal}?",
             "The amount sets the size of the goal.", 10),
    Question("date", "timelines", "What month and year would you like to reach your goal for {goal}?",
             "The month sets the deadline for the simulation.", 20, ("amount",)),
    Question("priority", "priorities", "How would you rank {goal}: high, medium, or low priority?",
             "Priority controls which goal is funded first.", 30, ("amount", "date")),
    Question("flexibility", "risk_flexibility", "If {goal} is tight, would you delay it, lower the target, or consider both?",
             "This identifies the trade-offs you would consider.", 40, ("priority",)),
    Question("permission", "risk_flexibility", "May I ask how comfortable you are with a tighter cash cushion for {goal}?",
             "You can skip this topic.", 50, ("flexibility",)),
    Question("risk", "risk_flexibility", "How would you feel about having less spare cash while saving for {goal}?",
             "This helps establish your comfort with a tighter budget.", 60, ("permission",), True),
)


def known_items(items: list[dict], confirmed: bool = False) -> dict[str, object]:
    allowed = {"confirmed"} if confirmed else {"confirmed", "pending"}
    return {i["key"]: i["value"] for i in items if i["status"] in allowed
            and (i["status"] == "confirmed" or i["kind"] == "fact")}


def next_question(memory: Memory, session: str, plan: Plan) -> dict:
    person = plan.person(memory.person(session))
    turn = memory.user_count(session)
    history = memory.question_history(session)
    if history and history[-1][0] == turn:
        return history[-1][1]
    asked = {q["key"]: when for when, q in history}
    skipped = {key for _, q in history for key in q.get("skipped", [])}
    last = memory.last_user(session)
    if history and last and SKIP.search(last["text"]):
        key = history[-1][1]["key"]
        skipped.add(key)
        if key.endswith(".permission"):
            skipped.add(key.replace(".permission", ".risk"))

    items = memory.items(person.id)
    known = known_items(items)
    goals = {i["key"]: known[i["key"]] for i in items if i["dimension"] == "goals" and "." not in i["key"] and i["key"] in known}
    candidates = []
    for slug, title in goals.items():
        fields = {k.split(".")[1]: v for k, v in known.items() if k.startswith(slug + ".")}
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", str(fields.get("date"))):
            fields.pop("date", None)
        existing = next((g for g in person.goals if g.name.casefold() == str(title).casefold()), None)
        if existing:
            fields.setdefault("amount", existing.target_chf)
            fields.setdefault("date", existing.target_date)
            fields.setdefault("priority", existing.priority)
        for q in CATALOGUE:
            key = f"{slug}.{q.field}"
            if q.field in fields or key in skipped or turn - asked.get(key, -100) < q.cooldown:
                continue
            if not all(p in fields or f"{slug}.{p}" in skipped for p in q.prerequisites):
                continue
            if q.sensitive and fields.get("permission") != "yes":
                continue
            candidates.append((q.priority, key, q, str(title).lower()))
    if candidates:
        _, key, q, title = min(candidates)
        memory.save(session, last["id"] if last else None, [Item(dimension=q.dimension, key=key, value=None,
                    kind="unknown", confidence=0.0, quote=None, why=q.reason)])
        return memory.question(session, turn, dict(key=key, question=("What purchase budget would you consider for the home?" if key == "home.amount" else q.prompt.format(goal=title)), dimension=q.dimension,
                                                    reason=q.reason, skipped=sorted(skipped)))
    return memory.question(session, turn, dict(key="discovery", dimension="goals", skipped=sorted(skipped),
                           question="What goal would you like to explore?" if not goals else "Is there another goal you would like to explore?",
                           reason="Learning which life decisions matter to you guides the simulation."))
