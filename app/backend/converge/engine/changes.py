"""Controlled registry of plan levers and validated application of changes.

Every modification — by a user, the recommendation engine or the language
model — is a ``Change(path, value)``. Only whitelisted paths are accepted and the
resulting plan is fully re-validated, so no component can bypass the schema.
"""
from __future__ import annotations

import copy
import re
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from converge.engine import months as M
from converge.models import Change, DescribedChange, Plan


class ChangeError(ValueError):
    pass


@dataclass(frozen=True)
class Lever:
    pattern: str
    label: str
    unit: str  # "CHF/month" | "CHF" | "month" | "%" | "rate" | "share" | "bool" | "enum" | "months" | "list"
    scope: str  # "person" | "shared" | "assumption"
    hint: str = ""

    @property
    def regex(self) -> re.Pattern:
        rx = re.escape(self.pattern).replace(r"\{pid\}", r"(?P<pid>[A-Za-z0-9_-]+)")
        rx = rx.replace(r"\{key\}", r"(?P<key>[A-Za-z0-9_-]+)").replace(r"\{gid\}", r"(?P<gid>[A-Za-z0-9_-]+)")
        rx = rx.replace(r"\{bid\}", r"(?P<bid>[A-Za-z0-9_-]+)")
        return re.compile(f"^{rx}$")


LEVERS: list[Lever] = [
    Lever("people.{pid}.categories.{key}.budget_monthly", "{category}", "CHF/month", "person", "Monthly budget for a spending category"),
    Lever("people.{pid}.income_monthly", "Net income", "CHF/month", "person", "Usual monthly net income"),
    Lever("people.{pid}.include_bonus", "Count observed bonus", "bool", "person"),
    Lever("people.{pid}.emergency_floor", "Minimum safety buffer", "CHF", "person", "Hard floor for personal cash"),
    Lever("people.{pid}.goals.{gid}.target_date", "{goal} — target date", "month", "person"),
    Lever("people.{pid}.goals.{gid}.target_chf", "{goal} — target", "CHF", "person"),
    Lever("people.{pid}.career_breaks", "Career breaks", "list", "person", "List of career breaks"),
    Lever("people.{pid}.career_breaks.{bid}.start", "Career break start", "month", "person"),
    Lever("people.{pid}.career_breaks.{bid}.months", "Career break length", "months", "person"),
    Lever("people.{pid}.career_breaks.{bid}.income_pct", "Income during break", "%", "person"),
    Lever("people.{pid}.career_breaks.{bid}.one_off_cost_chf", "Career break costs", "CHF", "person"),
    Lever("shared.household.enabled", "Live together", "bool", "shared"),
    Lever("shared.household.move_in", "Move-in date", "month", "shared"),
    Lever("shared.household.rent", "Shared rent", "CHF/month", "shared"),
    Lever("shared.household.utilities", "Shared utilities", "CHF/month", "shared"),
    Lever("shared.household.groceries", "Shared groceries", "CHF/month", "shared"),
    Lever("shared.household.moving_cost", "Moving costs", "CHF", "shared"),
    Lever("shared.split.mode", "Cost-sharing rule", "enum", "shared"),
    Lever("shared.split.custom_share_first", "{first}'s share of household costs", "share", "shared"),
    Lever("shared.split.adjust_for_breaks", "Partner covers more during a career break", "bool", "shared"),
    Lever("shared.property.enabled", "Buy a home", "bool", "shared"),
    Lever("shared.property.purchase", "Purchase date", "month", "shared"),
    Lever("shared.property.price", "Property price", "CHF", "shared"),
    Lever("shared.property.deposit_pct", "Deposit", "rate", "shared"),
    Lever("shared.property.fees_pct", "Purchase fees", "rate", "shared"),
    Lever("shared.property.ownership_share_first", "{first}'s share of the deposit", "share", "shared"),
    Lever("shared.property.mortgage_rate", "Mortgage rate", "rate", "shared"),
    Lever("shared.property.maintenance_pct", "Maintenance", "rate", "shared"),
    Lever("shared.property.amortize", "Amortise directly", "bool", "shared"),
    Lever("shared.property.target_date", "Home target date", "month", "shared"),
    Lever("assumptions.tax_rate", "Income tax (share of net income)", "rate", "assumption"),
    Lever("assumptions.expense_inflation", "Inflation", "rate", "assumption"),
    Lever("assumptions.income_growth", "Income growth", "rate", "assumption"),
    Lever("assumptions.investment_return", "Investment return", "rate", "assumption"),
    Lever("assumptions.cash_interest", "Interest on cash", "rate", "assumption"),
    Lever("assumptions.property_appreciation", "Property value growth", "rate", "assumption"),
    Lever("assumptions.horizon_months", "Plan horizon", "months", "assumption"),
]


def find_lever(path: str) -> tuple[Lever, dict[str, str]]:
    for lv in LEVERS:
        m = lv.regex.match(path)
        if m:
            return lv, m.groupdict()
    raise ChangeError(f"'{path}' is not a supported plan lever")


def _step(node: Any, seg: str) -> tuple[Any, Any]:
    """Return (container, key) for one path segment."""
    if isinstance(node, dict):
        if seg not in node:
            raise ChangeError(f"unknown field '{seg}'")
        return node, seg
    if isinstance(node, list):
        for i, el in enumerate(node):
            if isinstance(el, dict) and (el.get("id") == seg or el.get("key") == seg):
                return node, i
        raise ChangeError(f"no item '{seg}'")
    raise ChangeError(f"cannot descend into '{seg}'")


def _resolve(data: dict, path: str) -> tuple[Any, Any]:
    segs = path.split(".")
    node: Any = data
    container, key = None, None
    for seg in segs:
        container, key = _step(node, seg)
        node = container[key]
    return container, key


def get_value(plan: Plan | dict, path: str) -> Any:
    data = plan.model_dump() if isinstance(plan, Plan) else plan
    c, k = _resolve(data, path)
    return c[k]


def apply_changes(plan: Plan, changes: list[Change]) -> Plan:
    data = plan.model_dump()
    for ch in changes:
        find_lever(ch.path)
        c, k = _resolve(data, ch.path)
        c[k] = copy.deepcopy(ch.value)
    try:
        return Plan.model_validate(data)
    except ValidationError as e:
        msgs = "; ".join(f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors()[:5])
        raise ChangeError(f"invalid plan after changes: {msgs}") from None


def change_scope(plan: Plan, path: str) -> str:
    lv, g = find_lever(path)
    if lv.scope == "person":
        return g["pid"]
    return lv.scope


def required_approvers(plan: Plan, changes: list[Change]) -> list[str]:
    """Everyone whose personal plan is touched; both partners for shared/assumption changes."""
    ids = [p.id for p in plan.people]
    need: set[str] = set()
    for ch in changes:
        sc = change_scope(plan, ch.path)
        if sc in ("shared", "assumption"):
            need.update(ids)
        else:
            need.add(sc)
    return [i for i in ids if i in need]


def describe(plan: Plan, ch: Change) -> DescribedChange:
    lv, g = find_lever(ch.path)
    previous = get_value(plan, ch.path)
    label = lv.label
    owner = None
    if "pid" in g:
        person = plan.person(g["pid"])
        owner = person.name
        if "key" in g:
            cat = next((c for c in person.categories if c.key == g["key"]), None)
            label = label.replace("{category}", cat.label if cat else g["key"])
        if "gid" in g:
            goal = next((x for x in person.goals if x.id == g["gid"]), None)
            label = label.replace("{goal}", goal.name if goal else g["gid"])
    label = label.replace("{first}", plan.people[0].name)
    delta = None
    if lv.unit == "CHF/month" and isinstance(ch.value, (int, float)) and isinstance(previous, (int, float)):
        delta = float(ch.value) - float(previous)
    return DescribedChange(
        path=ch.path,
        value=ch.value,
        previous=previous,
        label=label,
        unit=lv.unit,
        scope=g.get("pid", lv.scope),
        owner_name=owner,
        delta_monthly_chf=delta,
        note=ch.note,
    )


def format_value(unit: str, v: Any) -> str:
    if v is None:
        return "—"
    if unit in ("CHF/month", "CHF"):
        s = f"CHF {float(v):,.0f}".replace(",", "’")
        return s + ("/month" if unit == "CHF/month" else "")
    if unit == "month" and isinstance(v, str):
        return M.label(v)
    if unit == "rate" and isinstance(v, (int, float)):
        return f"{float(v) * 100:.2f}".rstrip("0").rstrip(".") + "%"
    if unit == "%" and isinstance(v, (int, float)):
        return f"{float(v):.0f}%"
    if unit == "share" and isinstance(v, (int, float)):
        return f"{float(v) * 100:.0f}%"
    if unit == "months":
        return f"{int(v)} months"
    if unit == "bool":
        return "On" if v else "Off"
    if unit == "list" and isinstance(v, list) and all(isinstance(x, dict) and "months" in x for x in v):
        if not v:
            return "None"
        return "; ".join(
            f"{x['months']} months from {M.label(x['start'])}"
            + (f", {x.get('income_pct', 0):.0f}% income" if x.get("income_pct") else "")
            for x in v
        )
    if unit == "list" and isinstance(v, list):
        return f"{len(v)} item{'s' if len(v) != 1 else ''}"
    return str(v)


def lever_catalogue(plan: Plan) -> list[dict]:
    """Concrete, addressable levers for the current plan (used by the LLM tool schema)."""
    out = []
    for p in plan.people:
        out.append(dict(path=f"people.{p.id}.income_monthly", label=f"{p.name}: net income", unit="CHF/month"))
        out.append(dict(path=f"people.{p.id}.emergency_floor", label=f"{p.name}: minimum safety buffer", unit="CHF"))
        for c in p.categories:
            out.append(dict(path=f"people.{p.id}.categories.{c.key}.budget_monthly", label=f"{p.name}: {c.label}", unit="CHF/month"))
        for gl in p.goals:
            out.append(dict(path=f"people.{p.id}.goals.{gl.id}.target_date", label=f"{p.name}: {gl.name} date", unit="month"))
    for lv in LEVERS:
        if lv.scope != "person":
            out.append(dict(path=lv.pattern, label=lv.label.replace("{first}", plan.people[0].name), unit=lv.unit))
    return out
