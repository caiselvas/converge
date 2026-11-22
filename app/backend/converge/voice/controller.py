"""Deterministic selection of the next discovery question."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import re

from converge.models import Plan
from converge.voice.memory import Dimension, Item, Memory

MONTH = re.compile(r"\d{4}-(0[1-9]|1[0-2])")
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
    Question("why", "goals", "Why does {goal} matter to you?",
             "The motivation explains what the goal should preserve.", 5),
    Question("amount", "goals", "How much would you like to set aside for {goal}?",
             "The amount defines the target to simulate.", 10, ("why",)),
    Question("date", "timelines", "What month and year would you like to reach your goal for {goal}?",
             "The month sets the deadline for the simulation.", 20, ("amount",)),
    Question("flexibility", "risk_flexibility", "If the plan gets tight, would you delay {goal}, lower the target, or consider both?",
             "This identifies the trade-offs you would consider.", 25, ("amount", "date")),
    Question("partner_agreement", "priorities", "What would your partner need to agree on before you move ahead with the home?",
             "Buying a home is a shared decision.", 27, ("flexibility",)),
    Question("priority", "priorities", "How would you rank {goal}: high, medium, or low priority?",
             "Priority controls which goal is funded first.", 30, ("flexibility",)),
    Question("permission", "risk_flexibility", "May I ask how comfortable you are with a tighter cash cushion for {goal}?",
             "You can skip this topic.", 50, ("priority", "flexibility")),
    Question("risk", "risk_flexibility", "How would you feel about having less spare cash while saving for {goal}?",
             "This helps establish your comfort with a tighter budget.", 60, ("permission",), True),
)
LIFE = Question("life_priorities", "priorities", "Over the next five years, what matters most to you?",
                "Your priorities give the rest of the conversation context.", 0)
TRADEOFF = Question("goal_tradeoff", "priorities", "If {first} and {second} can’t both happen, which comes first?",
                    "Ranking the goals determines which one the plan funds first.", 8)


def known_items(items: list[dict], confirmed: bool = False) -> dict[str, object]:
    allowed = {"confirmed"} if confirmed else {"confirmed", "pending"}
    return {i["key"]: i["value"] for i in items if i["status"] in allowed
            and (i["status"] == "confirmed" or i["kind"] == "fact")}


def next_question(memory: Memory, session: str, plan: Plan, simulate_goal: Callable[[str, dict], str]) -> dict:
    person = plan.person(memory.person(session))
    turn = memory.user_count(session)
    history = memory.question_history(session)
    previous = history[-1][1] if history else {}
    if history and history[-1][0] == turn:
        return previous
    asked = {q["key"]: when for when, q in history}
    skipped = set(previous.get("skipped", []))
    last = memory.last_user(session)
    current = previous.get("key")
    if current and last and SKIP.search(last["text"]):
        skipped.add(current)
        if current.endswith(".permission"):
            skipped.add(current.replace(".permission", ".risk"))

    items = memory.items(person.id)
    known = known_items(items)
    goals = {i["key"]: known[i["key"]] for i in items if i["dimension"] == "goals" and "." not in i["key"] and i["key"] in known}
    previews = dict(previous.get("previews", {}))
    fresh = {}
    answered = set(known)
    candidates = []
    if LIFE.field not in known and LIFE.field not in skipped and LIFE.field not in asked:
        candidates.append((LIFE.priority, LIFE.field, LIFE, "", {}))
    for slug, title in goals.items():
        fields = {k.split(".")[1]: v for k, v in known.items() if k.startswith(slug + ".")}
        existing = next((g for g in person.goals if g.name.casefold() == str(title).casefold()), None)
        if existing:
            fields.setdefault("amount", existing.target_chf)
            fields.setdefault("date", existing.target_date)
            fields.setdefault("priority", existing.priority)
        if slug == "home" and plan.shared.property.enabled:
            fields.setdefault("amount", plan.shared.property.price)
            fields.setdefault("date", plan.shared.property.target_date)
        if not MONTH.fullmatch(str(fields.get("date"))):
            fields.pop("date", None)
            answered.discard(f"{slug}.date")
        complete = isinstance(fields.get("amount"), (float, int)) and "date" in fields
        if complete:
            inputs = [fields["amount"], fields["date"]]
            if previews.get(slug, {}).get("inputs") != inputs:
                values = {f"{slug}.{key}": value for key, value in fields.items()} | {slug: title}
                reaction = simulate_goal(slug, values)
                previews[slug] = {"inputs": inputs, "reaction": reaction}
                fresh[slug] = reaction
        answered.update(f"{slug}.{field}" for field in fields)
        for q in CATALOGUE:
            key = f"{slug}.{q.field}"
            if q.field == "partner_agreement" and slug != "home":
                continue
            if q.field in fields or key in skipped or turn - asked.get(key, -100) < q.cooldown:
                continue
            if not all(p in fields or f"{slug}.{p}" in skipped for p in q.prerequisites):
                continue
            if q.sensitive and fields.get("permission") != "yes":
                continue
            priority = q.priority
            if q.field == "flexibility" and complete and ("why" in fields or f"{slug}.why" in skipped
                    or (f"{slug}.amount" in known and f"{slug}.date" in known)):
                priority = 1
            candidates.append((priority, key, q, "the home purchase" if slug == "home" else f"your {str(title).lower()}", {}))

    if len(goals) >= 2 and TRADEOFF.field not in known and TRADEOFF.field not in skipped:
        options = dict(list(goals.items())[:2])
        candidates.append((TRADEOFF.priority, TRADEOFF.field, TRADEOFF, "", {"options": options}))

    # Cooldown governs selection of old questions. An active question stays active until resolved.
    if current and current not in answered and current not in skipped:
        waiting = current != "discovery" or set(goals) == set(previous.get("goal_keys", []))
        if waiting:
            result = {k: v for k, v in previous.items() if k != "reaction"}
            return memory.question(session, turn, result | {
                "previews": previews, "reaction": next(iter(fresh.values()), None),
            })

    if candidates:
        _, key, q, title, context = min(candidates)
        options = list(context.get("options", {}).values())
        if options:
            prompt = q.prompt.format(first=options[0], second=options[1])
        elif key == "home.amount":
            prompt = "What purchase budget would you consider for the home?"
        else:
            prompt = q.prompt.format(goal=title)
        slug = key.split(".")[0]
        reaction = (previews.get(slug, {}).get("reaction") if q.field == "flexibility" else
                    fresh.get(slug) or next(iter(fresh.values()), None))
        memory.save(session, last["id"] if last else None, [Item(dimension=q.dimension, key=key, value=None,
                    kind="unknown", confidence=0.0, quote=None, why=q.reason)])
        return memory.question(session, turn, dict(key=key, question=prompt, dimension=q.dimension,
                               reason=q.reason, skipped=sorted(skipped), reaction=reaction, previews=previews, **context))

    return memory.question(session, turn, dict(key="discovery", dimension="goals", skipped=sorted(skipped),
                           goal_keys=list(goals), previews=previews, reaction=next(iter(fresh.values()), None),
                           question="What goal would you like to explore?" if not goals else "Is there another goal you would like to explore?",
                           reason="Learning which life decisions matter to you guides the simulation."))
