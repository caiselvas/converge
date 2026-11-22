"""The only tool dispatcher used by discovery transports."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

from pydantic import Field

from converge import ai
from converge.engine import months as M
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
    focus_goal: str | None = None


class ProposalArgs(ai.StructuredOutput):
    changes: list[Change] = Field(default_factory=list, max_length=50)
    from_confirmed_goals: bool = False


class MemoryArgs(ai.StructuredOutput):
    items: list[Item] = Field(max_length=12)


def summary(plan: Plan, person: str | None = None, *, focus: tuple[str, str] | None = None) -> dict:
    ev = evaluate(plan)
    people = [{k: p[k] for k in ("id", "name", "min_cash", "min_cash_month", "goals")}
              for p in ev["people"] if person is None or p["id"] == person]
    issues = [i for i in ev["issues"] if person is None or i["person"] == person]
    hard = next((i for i in issues if i["severity"] == "hard"), None)
    status = "conflict" if hard else "attention" if issues else "on_track"
    lowest = min(people, key=lambda p: p["min_cash"])
    speakable = f"In this simulation, {lowest['name']}'s lowest cash is {chf(lowest['min_cash'])}."
    if hard and hard["kind"] == "liquidity_floor":
        name = plan.person(hard["person"]).name
        speakable = f"In this simulation, {name} falls {chf(hard['amount_chf'])} below their cash buffer in {M.label(hard['worst_month'])}."
    elif hard:
        speakable = f"In this simulation, {hard['title'][0].lower() + hard['title'][1:]}."
    elif focus:
        viewer, title = focus
        goal = next((g for p in people if p["id"] == viewer for g in p["goals"] if g["name"] == title), None)
        if goal and not goal["in_horizon"]:
            speakable = "In this simulation, that goal's deadline is beyond the plan horizon."
        elif goal and not goal["met"]:
            name = plan.person(viewer).name
            speakable = f"In this simulation, {name} falls {chf(goal['shortfall_chf'])} short of the goal in {M.label(goal['target_date'])}."
        elif goal and goal["met"]:
            speakable = f"In this simulation, the goal fits by {M.label(goal['target_date'])}."
        elif title == "Home" and ev["property"] and not ev["property"]["in_horizon"]:
            speakable = "In this simulation, the home purchase is beyond the plan horizon."
        elif title == "Home" and ev["property"]:
            speakable = f"In this simulation, the home fits in {M.label(ev['property']['purchase'])}."
    return dict(verdict=status, people=people, issues=[i["title"] for i in issues], speakable=speakable)


def goal_changes(plan: Plan, person: str, items: list[dict], *, preview: tuple[str, dict] | None = None) -> list[Change]:
    from pydantic import TypeAdapter, ValidationError

    known = preview[1] if preview else known_items(items, confirmed=True)
    personal = list(plan.person(person).goals)
    original = list(personal)
    changes = []
    slugs = [preview[0]] if preview else dict.fromkeys(
        item["key"] for item in items if item["dimension"] == "goals" and item["status"] == "confirmed"
    )
    for slug in slugs:
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
            if preview:
                changes.extend([Change(path="shared.property.enabled", value=True),
                                Change(path="shared.property.purchase", value=target)])
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
    "next_question": (Empty, "Get one next discovery question and any reaction from the simulation engine."),
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
        focus = (person, parsed.focus_goal) if parsed.focus_goal else None
        result = dict(before=summary(session.plan), after=summary(after, focus=focus))
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
        def simulate_goal(slug: str, fields: dict) -> str:
            changes = goal_changes(session.plan, person, [], preview=(slug, fields))
            result = execute_tool("simulate_changes", {
                "changes": [ch.model_dump() for ch in changes], "focus_goal": fields[slug],
            }, session)
            return result["after"]["speakable"]

        question = next_question(session.memory, session.id, session.plan, simulate_goal)
        if question.get("reaction"):
            session.memory.record_tool(session.id, {"reaction": question["reaction"]})
        return {k: v for k, v in question.items() if k not in {"previews", "skipped", "goal_keys"}}
    session.memory.record_tool(session.id, {key: value for key, value in result.items() if key != "draft_changes"})
    return result


def ground_turn(session: Session, text: str, before: list[dict] | None = None) -> bool:
    known = ai._fact_numbers(session.memory.recent_tools(session.id) if before is None else before)
    ungrounded = [n for n in ai._numbers_in(text)
                 if not any(abs(n - k) < 0.005 or abs(n - round(k)) < 0.005 for k in known)]
    if ungrounded:
        log.warning("Discovery transcript had %d ungrounded numeric claim(s)", len(ungrounded))
    return not ungrounded
