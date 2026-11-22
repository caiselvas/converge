"""The only tool dispatcher used by discovery transports."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Literal

from pydantic import Field

from converge import ai
from converge.engine import months as M
from converge.engine.changes import apply_changes
from converge.engine.evaluate import chf, evaluate
from converge.engine.recommend import recommend
from converge.engine.what_if import PROGRAMS, WhatIf, compare, compare_applied
from converge.models import Change, Goal, Month, Plan
from converge.voice.controller import get_gaps, goal_keys, known_items
from converge.voice.finance import CompareArgs, ProfileArgs, compare_paths, profile
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
    people = [{k: p[k] for k in ("id", "name", "min_cash", "min_cash_month", "floor", "headroom", "breach", "goals")}
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
    result = dict(verdict=status, people=people, issues=[i["title"] for i in issues], speakable=speakable,
                  provenance="simulated")
    if person is None:
        home = ev["property"]
        if home and (affordability := home.get("affordability")):
            home = {**home, "affordability": {
                **affordability,
                "ratio_pct": round(100 * affordability["ratio"], 1) if affordability["ratio"] is not None else None,
                "limit_pct": round(100 * affordability["max_ratio"], 1),
            }}
        result.update(home=home,
                      home_assumptions={"value": plan.shared.property.model_dump(), "provenance": "plan assumption"})
    return result


def goal_changes(plan: Plan, person: str, items: list[dict]) -> list[Change]:
    from pydantic import TypeAdapter, ValidationError

    known = known_items(items, confirmed=True)
    personal = list(plan.person(person).goals)
    original = list(personal)
    changes = []
    slugs = goal_keys([item for item in items if item["status"] == "confirmed"])
    for slug in slugs:
        title = known.get(f"{slug}.stated_goal", known.get(slug))
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
    "education_programs": (Empty, "Get published tuition, durations and source links for Quantitative Finance and Fine Arts."),
    "explore_what_if": (WhatIf, (
        "Compare the current plan with studying or a different housing arrangement, or combine both. "
        "For study, call education_programs and get_profile first. Supply a month, person ID and percent of usual pay "
        "during studies. Post-study pay delta defaults to zero. Ask for the user's expectation before testing a premium. "
        "For housing, use arrangement together or separate; separate turns off cohabitation and a joint home purchase. "
        "Use housing.purchase=include to test the configured purchase or exclude to remove it. "
        "Optional uncertainty varies inflation and investment returns, not future pay."
    )),
    "get_summary": (SummaryArgs, "Read the current plan's simulated cash and goals. Use scope together for configured mortgage affordability. To compare moving in, call explore_what_if."),
    "simulate_changes": (ChangesArgs, (
        "Compare a what-if with the current plan. Pass changes as [{path,value}]. "
        "To simulate moving in together, use shared.household.enabled=true; optionally use "
        "shared.household.move_in (YYYY-MM) and shared.household.rent (CHF/month). "
        "For a home purchase use shared.property.enabled=true, shared.property.price (CHF), and "
        "shared.property.purchase (YYYY-MM). Keep unspecified plan assumptions. "
        "Report both before and after results for the measure the user asks about."
    )),
    "list_recommendations": (Empty, "List options verified by the simulation engine."),
    "propose_changes": (ProposalArgs, "Queue validated changes for review in the app. Use from_confirmed_goals for saved goals."),
    "save_memory": (MemoryArgs, "Save pending evidence-backed observations from the last user turn. The viewer confirms them in the app."),
    "get_gaps": (Empty, "Get discovery coverage facts, confirmed objectives and opted-out topics. No suggested wording."),
    "get_profile": (ProfileArgs, "Read the requested partner's existing financial figures with provenance. Omit person for the viewer."),
    "compare_paths": (CompareArgs, 'Simulate two or three named paths with user-supplied or explicitly illustrative assumptions. Use the viewer ID from get_gaps or get_profile. For expected future pay set people.{pid}.income_steps to [{id,start,monthly_chf_delta,label}]. For temporary part-time pay and study fees use people.{pid}.career_breaks, value [{id,start,months,income_pct,one_off_cost_chf,label}]. Percentages there use 0–100, months use YYYY-MM.'),
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
        if parsed.scope == "together" and not session.plan.shared.property.enabled:
            hypothetical = apply_changes(session.plan, [Change(path="shared.property.enabled", value=True)])
            preview = summary(hypothetical, focus=(person, "Home"))
            baseline = {p["id"]: p for p in result["people"]}
            for p in preview["people"]:
                p["lowest_cash_change_chf"] = round(p["min_cash"] - baseline[p["id"]]["min_cash"], 2)
            result["configured_home_preview"] = preview
    elif isinstance(parsed, ProfileArgs):
        result = profile(session.plan, parsed.person or person, parsed.topic)
    elif isinstance(parsed, CompareArgs):
        result = compare_paths(session.plan, parsed)
    elif isinstance(parsed, WhatIf):
        result = compare(session.plan, parsed, include_series=False)
    elif name == "education_programs":
        result = PROGRAMS
    elif name == "simulate_changes":
        after = apply_changes(session.plan, parsed.changes)
        focus = (person, parsed.focus_goal) if parsed.focus_goal else None
        result = dict(before=summary(session.plan), after=summary(after, focus=focus), focus_goal=parsed.focus_goal)
        if after.assumptions.horizon_months == session.plan.assumptions.horizon_months:
            result["comparison"] = compare_applied(session.plan, after)
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
        return dict(memory=session.memory.save(session.id, last["id"], parsed.items))
    else:
        return get_gaps(session.memory, session.id, session.plan.person(person))
    session.memory.record_tool(session.id, {key: value for key, value in result.items() if key != "draft_changes"})
    return result


def unmatched_numbers(session: Session, text: str, before: list[dict] | None = None) -> list[float]:
    known = ai._fact_numbers(session.memory.recent_tools(session.id) if before is None else before)
    prose = re.sub(r"(?m)^\s*\d{1,2}[.)][ \t]+", "", text)
    return [n for n in ai._numbers_in(prose)
            if not any(abs(n - abs(k)) < 0.005 or abs(n - round(abs(k))) < 0.005 for k in known)]


def ground_turn(session: Session, text: str, before: list[dict] | None = None) -> bool:
    ungrounded = unmatched_numbers(session, text, before)
    if ungrounded:
        log.warning("Discovery transcript had %d ungrounded numeric claim(s)", len(ungrounded))
    return not ungrounded
