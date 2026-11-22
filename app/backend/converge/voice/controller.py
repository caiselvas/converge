"""Coverage facts for the coach. The model chooses what to discuss."""
from __future__ import annotations

import re

from converge.models import Person
from converge.voice.memory import Memory

DIMENSIONS = ("goals", "priorities", "timelines", "feasibility", "risk_flexibility")
FIELDS = {
    "stated_goal": "goals", "underlying_objective": "goals", "alternatives": "goals", "amount": "goals",
    "priority": "priorities", "decision_status": "priorities", "date": "timelines",
    "simulation": "feasibility", "constraints": "risk_flexibility", "flexibility": "risk_flexibility",
}
SKIP = re.compile(r"\b(prefer not to say|rather not say|skip this|skip that|let's skip|don't want to discuss)\b", re.I)
MONTH = re.compile(r"\d{4}-(0[1-9]|1[0-2])")


def known_items(items: list[dict], confirmed: bool = False) -> dict[str, object]:
    allowed = {"confirmed"} if confirmed else {"confirmed", "pending"}
    return {i["key"]: i["value"] for i in items if i["status"] in allowed and i["kind"] != "unknown"
            and (i["status"] == "confirmed" or i["kind"] == "fact")}


def goal_keys(items: list[dict]) -> dict[str, str]:
    goals = {}
    for item in items:
        key = item["key"]
        if (item["dimension"] == "goals" and ("." not in key or key.endswith(".stated_goal"))
                and item["status"] != "rejected" and (item["kind"] == "fact" or item["status"] == "confirmed")
                and isinstance(item["value"], str)):
            goals[key.split(".")[0]] = item["value"]
    return goals


def get_gaps(memory: Memory, session: str, person: Person) -> dict:
    items = [i for i in memory.items(person.id) if i["status"] != "rejected"]
    known = known_items(items)
    confirmed = known_items(items, confirmed=True)
    skipped = {i["key"].removeprefix("skip.") for i in items if i["key"].startswith("skip.") and i["kind"] == "fact"}
    skipped.update(key for _, entry in memory.question_history(session) for key in entry.get("skipped", ()))
    simulations = {r["focus_goal"] for r in memory.recent_tools(session) if r.get("focus_goal")}
    dimensions = {d: {"known": [], "unknown": []} for d in DIMENSIONS}
    for item in items:
        if item["key"].startswith("skip."):
            continue
        dimension = dimensions[item["dimension"]]
        if item["kind"] == "unknown":
            if item["key"] not in known and not is_skipped(item["key"], skipped):
                dimension["unknown"].append({"key": item["key"]})
        else:
            dimension["known"].append({key: item[key] for key in ("id", "key", "value", "kind", "status", "quote")})

    goals = {}
    stated = goal_keys(items)
    for key in confirmed:
        if key.endswith(".underlying_objective"):
            stated.setdefault(key.split(".")[0], None)
    for slug, title in stated.items():
        fields = {key.split(".")[1]: value for key, value in known.items() if key.startswith(slug + ".")}
        if title:
            fields["stated_goal"] = title
        existing = next((goal for goal in person.goals if title and goal.name.casefold() == title.casefold()), None)
        if existing:
            for key, value in (("amount", existing.target_chf), ("date", existing.target_date), ("priority", existing.priority)):
                fields.setdefault(key, value)
        if not MONTH.fullmatch(str(fields.get("date"))):
            fields.pop("date", None)
        objective = confirmed.get(f"{slug}.underlying_objective")
        if objective is None:
            fields.pop("underlying_objective", None)
        if slug in simulations or title in simulations:
            fields["simulation"] = "run"
        missing = [field for field in FIELDS if field not in fields and not is_skipped(f"{slug}.{field}", skipped)]
        for field in missing:
            entry = {"key": f"{slug}.{field}"}
            if not any(i["key"] == entry["key"] for i in dimensions[FIELDS[field]]["unknown"]):
                dimensions[FIELDS[field]]["unknown"].append(entry)
        goals[slug] = {
            "stated_goal": title, "confirmed_underlying_objective": objective, "known": fields,
            "unknown_fields": missing, "decision_status": confirmed.get(f"{slug}.decision_status", "exploring"),
            "alternatives_discussed": [i["value"] for i in items if i["key"] == f"{slug}.alternatives"],
        }
    return {
        "dimensions": dimensions, "goals": goals, "skipped_topics": sorted(skipped),
        "means_without_confirmed_objective": [slug for slug, goal in goals.items() if goal["stated_goal"] and goal["confirmed_underlying_objective"] is None],
        "known_from_profile": {"viewer": person.name, "person_id": person.id, "topics": ["income", "spending", "balances", "debts", "goals"],
                               "goals": [goal.name for goal in person.goals]},
    }


def is_skipped(key: str, skipped: set[str]) -> bool:
    return key in skipped or key.rsplit(".", 1)[-1] in skipped
