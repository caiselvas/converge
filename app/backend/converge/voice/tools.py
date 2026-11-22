"""The only tool dispatcher used by discovery transports."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

from pydantic import Field

from converge import ai
from converge.engine.changes import apply_changes
from converge.engine.evaluate import chf, evaluate
from converge.engine.recommend import recommend
from converge.models import Change, Goal, Month, Plan
from converge.voice.controller import known_items, next_question
from converge.voice.memory import Item, Memory

log = logging.getLogger(__name__)


@dataclass
class Session:
    memory: Memory
    id: str
    plan: Plan

    @property
    def person_id(self):
        return self.memory.person(self.id)

    @property
    def last_question(self):
        history = self.memory.question_history(self.id)
        return history[-1][1] if history else None


class Empty(ai.StructuredOutput):
    pass


class SummaryArgs(ai.StructuredOutput):
    scope: Literal["personal", "together"] = "personal"


class ChangesArgs(ai.StructuredOutput):
    changes: list[Change] = Field(default_factory=list, max_length=50)


class ProposalArgs(ChangesArgs):
    from_confirmed_goals: bool = False


class MemoryArgs(ai.StructuredOutput):
    items: list[Item] = Field(max_length=12)


def summary(plan: Plan, person: str | None = None) -> dict:
    ev = evaluate(plan)
    people = [{k: p[k] for k in ("id", "name", "min_cash", "min_cash_month", "goals")}
              for p in ev["people"] if person is None or p["id"] == person]
    issues = [i for i in ev["issues"] if person is None or i["person"] == person]
    status = "conflict" if any(i["severity"] == "hard" for i in issues) else "attention" if issues else "on_track"
    lowest = min(people, key=lambda p: p["min_cash"])
    return dict(verdict=status, people=people, issues=[i["title"] for i in issues],
                speakable=f"In this simulation, {lowest['name']}'s lowest cash is {chf(lowest['min_cash'])}.")


def goal_changes(plan: Plan, person: str, items: list[dict]) -> list[Change]:
    from pydantic import TypeAdapter, ValidationError

    known = known_items(items, confirmed=True)
    personal = list(plan.person(person).goals)
    original = list(personal)
    changes = []
    for slug in dict.fromkeys(item["key"] for item in items if item["dimension"] == "goals" and item["status"] == "confirmed"):
        title = known.get(slug)
        amount = known.get(f"{slug}.amount")
        date = known.get(f"{slug}.date")
        if not isinstance(title, str) or not isinstance(amount, (float, int)) or not 0 < amount <= 1e9:
            continue
        try:
            target = TypeAdapter(Month).validate_python(date)
        except ValidationError:
            continue
        if slug == "home":
            changes.extend([Change(path="shared.property.price", value=amount),
                            Change(path="shared.property.target_date", value=target)])
            continue
        priority = known.get(f"{slug}.priority")
        existing = next((g for g in personal if g.id == f"discovery-{slug}" or g.name.casefold() == title.casefold()), None)
        if existing:
            updated = existing.model_copy(update={
                "target_chf": amount, "target_date": target,
                "priority": priority if priority in ("high", "medium", "low") else existing.priority,
            })
            personal = [updated if goal.id == existing.id else goal for goal in personal]
        else:
            personal.append(Goal(id=f"discovery-{slug}", name=title, target_chf=amount, target_date=target,
                                 priority=priority if priority in ("high", "medium", "low") else "medium", source="user"))
    if personal != original:
        changes.append(Change(path=f"people.{person}.goals", value=[g.model_dump() for g in personal]))
    return changes


TOOLS = {
    "get_summary": (SummaryArgs, "Get the simulated verdict and lowest cash. Default scope is the viewer."),
    "simulate_changes": (ChangesArgs, "Compare the current plan to a hypothetical list of whitelisted changes."),
    "list_recommendations": (Empty, "List options verified by the simulation engine."),
    "propose_changes": (ProposalArgs, "Queue validated changes for review in the app. Use from_confirmed_goals for saved goals."),
    "save_memory": (MemoryArgs, "Save pending evidence-backed observations from the last user turn. The viewer confirms them in the app."),
    "next_question": (Empty, "Get the single next discovery question."),
}


def definitions() -> list[dict]:
    return [dict(type="function", name=name, description=description, parameters=model.model_json_schema())
            for name, (model, description) in TOOLS.items()]


def execute_tool(name: str, args: dict, session: Session) -> dict:
    if name not in TOOLS:
        raise ValueError("Unknown discovery tool.")
    parsed = TOOLS[name][0].model_validate(args)
    person = session.person_id
    session.plan.person(person)
    if isinstance(parsed, SummaryArgs):
        result = summary(session.plan, person if parsed.scope == "personal" else None)
    elif name == "simulate_changes":
        after = apply_changes(session.plan, parsed.changes)
        result = dict(before=summary(session.plan), after=summary(after))
        if not any(ch.path.startswith("people.") and ".goals" in ch.path for ch in parsed.changes):
            result["draft_changes"] = [ch.model_dump() for ch in parsed.changes]
    elif name == "list_recommendations":
        result = recommend(session.plan)
    elif isinstance(parsed, ProposalArgs):
        changes = parsed.changes
        if parsed.from_confirmed_goals:
            if changes:
                raise ValueError("Choose explicit changes or confirmed goals.")
            changes = goal_changes(session.plan, person, session.memory.items(person))
        elif any(ch.path.startswith("people.") and ".goals" in ch.path for ch in changes):
            raise ValueError("Confirm goal details in discovery memory before drafting a goal.")
        if not changes:
            raise ValueError("No complete, confirmed goals or explicit changes are available.")
        apply_changes(session.plan, changes)
        return dict(draft_changes=[ch.model_dump() for ch in changes])
    elif isinstance(parsed, MemoryArgs):
        last = session.memory.last_user(session.id)
        if not last:
            raise ValueError("Wait for a user turn before saving memory.")
        return dict(memory=session.memory.save(session.id, last["id"], parsed.items, session.last_question))
    else:
        return next_question(session.memory, session.id, session.plan)
    session.memory.record_tool(session.id, {key: value for key, value in result.items() if key != "draft_changes"})
    return result


def ground_turn(session: Session, text: str, before: list[dict] | None = None) -> bool:
    known = ai._fact_numbers(session.memory.recent_tools(session.id) if before is None else before)
    ungrounded = [n for n in ai._numbers_in(text)
                 if not any(abs(n - k) < 0.005 or abs(n - round(k)) < 0.005 for k in known)]
    if ungrounded:
        log.warning("Discovery transcript had %d ungrounded numeric claim(s)", len(ungrounded))
    return not ungrounded
