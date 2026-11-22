"""Life-decision planning: a guided intake that compiles into validated plan changes.

A *decision module* declares the questions a couple needs to answer, where each
answer lives in the plan (a whitelisted lever path, or a small compile step),
how to prefill from the agreed plan, and how the answers become ``Change``
objects. Nothing here calculates financial results: consequences come from the
deterministic engine (``evaluate``), exactly as for any other plan edit.

Interview answers are kept in a :class:`DecisionSession`, separate from the
agreed plan and from each partner's personal draft. They only reach the plan
through a proposal in the normal approval workflow.

Personal preferences (priorities, what each partner is willing to change) are
stored per partner and can only be set by that partner. They are never inferred
from transaction data and are never used to change the plan by themselves.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field

from converge.engine import months as M
from converge.engine.changes import ChangeError, apply_changes, describe, format_value, get_value
from converge.models import MONTH_RE, Change, Child, ParentalLeave, Plan

Kind = Literal["month", "chf", "share", "choice", "partner", "number", "bool", "text"]
Stage = Literal["intention", "couple", "details"]
Group = Literal["decision", "responsibilities", "priorities", "assumptions"]
Values = dict[str, Any]


class AnswerError(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class DecisionSession(BaseModel):
    """A couple's in-progress answers for one decision module."""

    module: str
    answers: dict[str, Any] = {}
    answered_by: dict[str, str] = {}
    preferences: dict[str, dict[str, Any]] = {}  # question id -> partner id -> value
    adjustments: list[Change] = []  # extra validated changes, e.g. from a verified alternative
    proposal_id: str | None = None
    updated_at: str = Field(default_factory=_now)
    updated_by: str | None = None


@dataclass(frozen=True)
class Option:
    value: str
    label: str
    keywords: tuple[str, ...] = ()
    stance: Literal["flexible", "firm"] | None = None


@dataclass(frozen=True)
class Question:
    id: str
    kind: Kind
    label: str
    prompt: str
    stage: Stage
    group: Group
    help: str | Callable[[Plan, dict], str] = ""
    path: str | None = None
    read: Callable[[Plan], Any] | None = None
    suggest: Callable[[Plan, Values], Any] | None = None
    known_when: Callable[[Plan], bool] | None = None
    applies: Callable[[Values], bool] | None = None
    options: tuple[Option, ...] = ()
    per_partner: bool = False
    topic: str = ""
    role: Literal["taker", "partner"] | None = None
    source: Literal["assumption", "data"] = "assumption"
    min: float | None = None
    max: float | None = None
    step: float | None = None
    unit: str = ""
    decimals: int = 0
    integer: bool = False

    def current(self, plan: Plan) -> Any:
        if self.read is not None:
            return self.read(plan)
        if self.path is not None:
            return get_value(plan, self.path)
        return None


@dataclass(frozen=True)
class DecisionModule:
    id: str
    title: str
    promise: str
    questions: tuple[Question, ...]
    active: Callable[[Plan], bool]
    compile: Callable[[Plan, Values], list[Change]]
    remove: Callable[[Plan], list[Change]]
    headline: Callable[[Plan, Values], str]
    notes: Callable[[Plan, Values], list[str]]
    amount_base: Callable[[str, Values, dict | None], float | None] = lambda qid, v, ev: None

    def question(self, qid: str) -> Question:
        for q in self.questions:
            if q.id == qid:
                return q
        raise AnswerError(f"'{qid}' is not a question of {self.title}")


# --------------------------------------------------------------------------- shared helpers


def _chf(v: float) -> str:
    return format_value("CHF", v)


def _names(plan: Plan) -> dict[str, str]:
    return {"first": plan.people[0].name, "second": plan.people[1].name}


def _render(text: str, plan: Plan) -> str:
    n = _names(plan)
    return text.replace("{first}", n["first"]).replace("{second}", n["second"])


def _rent(person) -> float:
    return next((c.budget_monthly for c in person.categories if c.key == "housing_rent"), 0.0)


def _applies(q: Question, values: Values) -> bool:
    return q.applies is None or bool(q.applies(values))


def _later(plan: Plan, month: str, months_from_start: int) -> str:
    """``month`` when it lies in the plan, otherwise a sensible month after the plan start."""
    start = plan.assumptions.start
    return month if M.index(month, start) >= 0 else M.add(start, months_from_start)


def _shared_known(plan: Plan) -> bool:
    return plan.shared.household.enabled or plan.shared.property.enabled


SPLIT_OPTIONS = (
    Option("income", "In proportion to our incomes", ("income", "proportion", "proportional", "earn")),
    Option("equal", "Equally, half each", ("equal", "half", "50/50", "fifty", "same")),
    Option("custom", "A custom split", ("custom", "different", "other split")),
)


def _split_questions(prefix_stage: Stage = "couple") -> tuple[Question, ...]:
    return (
        Question(
            "split_mode", "choice", "Sharing household costs",
            "How would you like to share rent, utilities, groceries and other joint costs?",
            prefix_stage, "responsibilities", path="shared.split.mode", options=SPLIT_OPTIONS,
            known_when=_shared_known,
            help="Shared costs are paid from a joint account that you both fund in this split.",
        ),
        Question(
            "custom_share_first", "share", "{first}'s share of household costs",
            "What share of the household costs would {first} pay?",
            prefix_stage, "responsibilities", path="shared.split.custom_share_first",
            applies=lambda v: v.get("split_mode") == "custom", known_when=_shared_known,
            min=0, max=1, step=0.05,
        ),
    )


# --------------------------------------------------------------------------- move in together


def _move_in_help(plan: Plan, ctx: dict) -> str:
    a, b = plan.people
    return (f"Today {a.name} pays {_chf(_rent(a))} and {b.name} {_chf(_rent(b))} a month in rent. "
            "From the move-in month, one shared rent replaces both.")


MOVE_IN = DecisionModule(
    id="move-in",
    title="Move in together",
    promise="See what one shared home costs each of you, and how a fair split keeps both safety buffers intact.",
    active=lambda plan: plan.shared.household.enabled,
    questions=(
        Question(
            "move_in", "month", "Move-in date", "When would you like to move in together?",
            "intention", "decision", path="shared.household.move_in",
            suggest=lambda plan, v: _later(plan, plan.shared.household.move_in, 3),
            help="Until then, each of you keeps paying for your current home.",
        ),
        Question(
            "rent", "chf", "Shared rent", "What monthly rent are you considering for your shared home?",
            "intention", "decision", path="shared.household.rent", help=_move_in_help,
            min=0, max=20_000, step=50, unit="/month",
        ),
        *_split_questions(),
        Question(
            "priority", "choice", "What matters most", "What matters most to you about moving in together?",
            "couple", "priorities", per_partner=True, topic="Priority",
            options=(
                Option("savings", "Keep building my savings", ("save", "savings", "money")),
                Option("home", "A home that feels right, even if it costs more", ("space", "home", "nice", "bigger")),
                Option("fairness", "A split that feels fair to both of us", ("fair", "split")),
                Option("flexibility", "Keeping my options open", ("option", "flexib", "free")),
            ),
        ),
        Question(
            "rent_flex", "choice", "Rent", "If the numbers turn out tight, would you look for a cheaper home?",
            "couple", "priorities", per_partner=True, topic="Rent",
            options=(
                Option("yes", "Yes, I'd look for something cheaper", ("yes", "cheaper", "sure"), "flexible"),
                Option("some", "A little, but not much", ("little", "bit", "somewhat", "maybe")),
                Option("no", "No, this rent is a fixed point for me", ("no", "fixed", "not"), "firm"),
            ),
        ),
        Question("utilities", "chf", "Shared utilities", "Monthly utilities for the shared home",
                 "details", "assumptions", path="shared.household.utilities", source="data",
                 help="Starts from the higher of your current utility bills plus 30%.", min=0, max=5_000, step=10, unit="/month"),
        Question("groceries", "chf", "Shared groceries", "Monthly groceries for both of you",
                 "details", "assumptions", path="shared.household.groceries", source="data",
                 help="Both partners' observed groceries added together, with no economies of scale.",
                 min=0, max=5_000, step=20, unit="/month"),
        Question("moving_cost", "chf", "Moving costs", "One-off moving costs",
                 "details", "assumptions", path="shared.household.moving_cost",
                 help="Paid once in the move-in month and shared in your split.", min=0, max=50_000, step=250),
    ),
    compile=lambda plan, v: [Change(path="shared.household.enabled", value=True)],
    remove=lambda plan: [Change(path="shared.household.enabled", value=False)],
    headline=lambda plan, v: f"Rent {_chf(v['rent'])}/month from {M.label(v['move_in'])}",
    notes=lambda plan, v: [
        "Rent and shared costs grow with the plan's inflation assumption.",
        "Utilities and groceries start from your observed UBS spending; edit them if the new home differs.",
    ],
)


# --------------------------------------------------------------------------- buy a home


def _price_help(plan: Plan, ctx: dict) -> str:
    ev = ctx.get("eval")
    aff = (ev or {}).get("property") and ev["property"].get("affordability")
    text = "This is the purchase price. Purchase fees and the deposit come out of your savings in the purchase month."
    if aff and aff.get("max_price"):
        text += (f" Based on your combined usual net pay, the indicative affordability check passes up to about "
                 f"{_chf(aff['max_price'])} with this deposit.")
    return text


def _deposit_help(plan: Plan, ctx: dict) -> str:
    a, b = plan.people
    return (f"Swiss lenders expect at least 20%. Today {a.name} holds {_chf(a.opening_cash)} and "
            f"{b.name} {_chf(b.opening_cash)} in cash. A larger deposit lowers the mortgage but uses more savings.")


def _move_before(plan: Plan) -> str:
    hh, pr = plan.shared.household, plan.shared.property
    return "rent_first" if hh.enabled and (not pr.enabled or hh.move_in < pr.purchase) else "at_purchase"


def _home_compile(plan: Plan, v: Values) -> list[Change]:
    out = [Change(path="shared.property.enabled", value=True), Change(path="shared.household.enabled", value=True)]
    if v.get("move_before") == "at_purchase":
        out.append(Change(path="shared.household.move_in", value=v["purchase"]))
    return out


def _home_base(qid: str, v: Values, ev: dict | None) -> float | None:
    if qid == "deposit_pct":
        return float(v["price"])
    if qid == "ownership_share_first":
        return float(v["price"]) * (float(v["deposit_pct"]) + float(v["fees_pct"]))
    return None


BUY_HOME = DecisionModule(
    id="buy-home",
    title="Buy a home",
    promise="Find out whether a purchase date and budget work for both of you, who pays what, and what it does to each safety net.",
    active=lambda plan: plan.shared.property.enabled,
    questions=(
        Question(
            "price", "chf", "Home price", "Roughly what price are you looking at for your home?",
            "intention", "decision", path="shared.property.price", help=_price_help,
            min=100_000, max=10_000_000, step=50_000,
        ),
        Question(
            "purchase", "month", "Purchase date", "When would you ideally like to buy?",
            "intention", "decision", path="shared.property.purchase",
            suggest=lambda plan, v: _later(plan, plan.shared.property.purchase, 15),
            help="Mortgage interest, maintenance and amortisation start the month after the purchase.",
        ),
        Question(
            "target_date", "month", "Own by, at the latest", "What is the latest you would still be happy to own a home by?",
            "intention", "decision", path="shared.property.target_date",
            suggest=lambda plan, v: M.add(v["purchase"], 6),
            help="If the plan only works with a later purchase, Converge flags it against this date.",
        ),
        Question(
            "deposit_pct", "share", "Deposit", "How much of the price do you want to put down as a deposit?",
            "intention", "decision", path="shared.property.deposit_pct", help=_deposit_help,
            min=0.2, max=0.6, step=0.01,
        ),
        Question(
            "ownership_share_first", "share", "Who pays the deposit",
            "How will you split the deposit and purchase fees between you?",
            "couple", "responsibilities", path="shared.property.ownership_share_first",
            help="Ownership, mortgage interest and maintenance follow the same split.", min=0, max=1, step=0.05,
        ),
        Question(
            "move_before", "choice", "Moving in", "Will you move in together before you buy?",
            "couple", "decision", read=_move_before, known_when=lambda plan: plan.shared.household.enabled,
            options=(
                Option("rent_first", "Yes, we'll rent together first", ("yes", "rent", "first", "before")),
                Option("at_purchase", "No, we'll move in when we buy", ("no", "when we buy", "at purchase", "together when")),
            ),
        ),
        Question(
            "move_in", "month", "Move-in date", "When would you move in together?",
            "couple", "decision", path="shared.household.move_in",
            applies=lambda v: v.get("move_before") == "rent_first", known_when=lambda plan: plan.shared.household.enabled,
            suggest=lambda plan, v: _later(plan, plan.shared.household.move_in, 3),
        ),
        Question(
            "rent", "chf", "Shared rent until you buy", "What monthly rent would you pay together until you buy?",
            "couple", "decision", path="shared.household.rent", help=_move_in_help,
            applies=lambda v: v.get("move_before") == "rent_first", known_when=lambda plan: plan.shared.household.enabled,
            min=0, max=20_000, step=50, unit="/month",
        ),
        *_split_questions(),
        Question(
            "priority", "choice", "What matters most", "What matters most to you in buying a home?",
            "couple", "priorities", per_partner=True, topic="Priority",
            options=(
                Option("safety", "Keeping my personal savings safe", ("safe", "safety", "savings", "secure")),
                Option("speed", "Buying as soon as possible", ("soon", "fast", "quick", "early")),
                Option("costs", "Keeping monthly costs low", ("monthly", "low cost", "cheap", "costs")),
                Option("lifestyle", "Keeping our current lifestyle", ("lifestyle", "spending", "life")),
            ),
        ),
        Question(
            "date_flex", "choice", "Purchase date",
            "Is the purchase date essential to you, or would you wait longer if that made the plan safer?",
            "couple", "priorities", per_partner=True, topic="Purchase date",
            options=(
                Option("fixed", "The date is essential to me", ("essential", "fixed", "must", "no"), "firm"),
                Option("months", "I could wait a few months", ("few months", "months", "bit")),
                Option("year", "I'd wait a year or more", ("year", "longer", "wait", "yes"), "flexible"),
            ),
        ),
        Question(
            "budget_flex", "choice", "Budget",
            "Would you rather reduce the property budget or keep it and trim your spending?",
            "couple", "priorities", per_partner=True, topic="Budget",
            options=(
                Option("lower", "Reduce the budget", ("reduce", "lower", "cheaper", "budget"), "flexible"),
                Option("trim", "Keep the budget, trim our spending", ("keep", "trim", "spending", "cut")),
                Option("either", "Either is fine", ("either", "both", "fine", "don't mind")),
            ),
        ),
        Question("mortgage_rate", "share", "Mortgage rate", "Mortgage interest rate", "details", "assumptions",
                 path="shared.property.mortgage_rate", min=0, max=0.15, step=0.001, decimals=2,
                 help="Illustrative fixed rate for a new mortgage. Stress-test higher rates on Overview."),
        Question("amortize", "bool", "Amortise directly", "Repay the second mortgage directly within 15 years?",
                 "details", "assumptions", path="shared.property.amortize",
                 help="Swiss practice: the part above two thirds of the value is repaid within 15 years."),
        Question("fees_pct", "share", "Purchase fees", "Notary, land-registry and mortgage-note fees", "details",
                 "assumptions", path="shared.property.fees_pct", min=0, max=0.1, step=0.005, decimals=1,
                 help="Paid once in the purchase month, in your ownership split."),
        Question("utilities", "chf", "Shared utilities", "Monthly utilities for the shared home",
                 "details", "assumptions", path="shared.household.utilities", source="data",
                 min=0, max=5_000, step=10, unit="/month",
                 help="Starts from the higher of your current utility bills plus 30%."),
        Question("groceries", "chf", "Shared groceries", "Monthly groceries for both of you",
                 "details", "assumptions", path="shared.household.groceries", source="data",
                 min=0, max=5_000, step=20, unit="/month",
                 help="Both partners' observed groceries added together, with no economies of scale."),
        Question("moving_cost", "chf", "Moving costs", "One-off moving costs", "details", "assumptions",
                 path="shared.household.moving_cost", min=0, max=50_000, step=250,
                 help="Paid once when you move in together."),
    ),
    compile=_home_compile,
    remove=lambda plan: [Change(path="shared.property.enabled", value=False)],
    headline=lambda plan, v: f"{_chf(v['price'])} home in {M.label(v['purchase'])}",
    amount_base=_home_base,
    notes=lambda plan, v: [
        "The affordability check is indicative. It uses your combined usual net pay; lenders assess gross income.",
        "Property value is held flat and the mortgage rate is illustrative. Use the stress test on Overview to try higher rates.",
        "Investments are not sold to fund the deposit. The deposit comes from cash.",
    ],
)


# --------------------------------------------------------------------------- have a child


def _target_child(plan: Plan) -> Child | None:
    return min(plan.shared.children, key=lambda c: c.birth) if plan.shared.children else None


def _child_attr(attr: str, default: Callable[[Plan], Any]):
    def read(plan: Plan) -> Any:
        child = _target_child(plan)
        return getattr(child, attr) if child else default(plan)
    return read


def _child_break(plan: Plan):
    child = _target_child(plan)
    if not child:
        return None, None
    for i, p in enumerate(plan.people):
        for b in p.career_breaks:
            if b.id == f"cb-{child.id}":
                return ("first", "second")[i], b
    return None, None


def _child_compile(plan: Plan, v: Values) -> list[Change]:
    first, second = plan.people
    target = _target_child(plan)
    if target:
        cid, label = target.id, target.label
    else:
        n = 1
        while any(c.id == f"child-{n}" for c in plan.shared.children):
            n += 1
        cid, label = f"child-{n}", f"Child {n}"
    birth_parent = v["birth_parent"]
    other_parent = second.id if birth_parent == first.id else first.id
    base = target.model_dump() if target else Child(
        id=cid, label=label, birth=v["birth"], allowance_recipient=birth_parent,
        leave=ParentalLeave(birth_parent=birth_parent, other_parent=other_parent),
    ).model_dump()
    child = {
        **base,
        "birth": v["birth"],
        "childcare_days_per_week": float(v["childcare_days"]),
        "childcare_start_months_after_birth": int(v["childcare_start"]),
        "childcare_until_age": int(v["childcare_until"]),
        "everyday_cost_monthly": float(v["everyday_cost"]),
        "allowance_recipient": v["allowance_recipient"],
        "leave": {"birth_parent": birth_parent, "other_parent": other_parent},
    }
    children = [c.model_dump() for c in plan.shared.children]
    children = [child if c["id"] == cid else c for c in children] if target else [*children, child]
    out = [Change(path="shared.children", value=children)]

    bid = f"cb-{cid}"
    taker = {"first": first.id, "second": second.id}.get(v.get("extra_leave", "none"))
    for p in plan.people:
        current = [b.model_dump() for b in p.career_breaks]
        breaks = [b for b in current if b["id"] != bid]
        if p.id == taker:
            # The extra time off starts after the statutory leave: 98 days from the
            # first of the birth month end in the fourth month, 14 days in the first.
            start = M.add(v["birth"], 4 if p.id == birth_parent else 1)
            breaks.append(dict(id=bid, start=start, months=int(v["extra_leave_months"]),
                               income_pct=float(v["extra_leave_income"]), one_off_cost_chf=0.0,
                               label="Time off after the birth"))
        if breaks != current:
            out.append(Change(path=f"people.{p.id}.career_breaks", value=breaks))
    return out


def _child_remove(plan: Plan) -> list[Change]:
    target = _target_child(plan)
    if not target:
        return []
    out = [Change(path="shared.children", value=[c.model_dump() for c in plan.shared.children if c.id != target.id])]
    for p in plan.people:
        if any(b.id == f"cb-{target.id}" for b in p.career_breaks):
            out.append(Change(path=f"people.{p.id}.career_breaks",
                              value=[b.model_dump() for b in p.career_breaks if b.id != f"cb-{target.id}"]))
    return out


def _child_notes(plan: Plan, v: Values) -> list[str]:
    a = plan.assumptions
    end = M.add(a.start, a.horizon_months - 1)
    age = M.index(end, v["birth"]) + 1
    if age <= 0:
        span = f"The projection ends in {M.label(end)}, before this birth, so it shows none of the child's costs."
    else:
        years, months = divmod(age, 12)
        covered = " and ".join(x for x in (f"{years} year{'s' if years != 1 else ''}" if years else "",
                                           f"{months} month{'s' if months != 1 else ''}" if months else "") if x)
        span = (f"The projection ends in {M.label(end)}, so it covers only your child's first {covered}. "
                "Raising a child costs far more over the years than this window shows.")
    return [
        span,
        "Not included: school-age care, education, a larger home, child tax deductions and income-based Kita subsidies.",
        "Statutory leave pays 80% of usual net pay, capped at CHF 220 a day. Family allowances follow Zurich rates.",
    ]


def _first(plan: Plan) -> str:
    return plan.people[0].id


HAVE_CHILD = DecisionModule(
    id="have-child",
    title="Have a child",
    promise="Understand how parental leave, childcare and time at home change each partner's cash in the first years.",
    active=lambda plan: bool(plan.shared.children),
    questions=(
        Question(
            "birth", "month", "Expected birth", "When are you thinking of having a child?",
            "intention", "decision",
            read=_child_attr("birth", lambda plan: M.add(plan.assumptions.start, 12)),
            help="An approximate month is enough. You can move it later and compare.",
        ),
        Question(
            "birth_parent", "partner", "Birth leave",
            "Who will take the 98-day birth leave? The other parent takes 14 days of other-parent leave.",
            "intention", "responsibilities",
            read=lambda plan: (_target_child(plan).leave.birth_parent if _target_child(plan) else _first(plan)),
        ),
        Question(
            "childcare_days", "number", "Days in childcare", "How many days a week would your child go to a Kita?",
            "couple", "decision", read=_child_attr("childcare_days_per_week", lambda plan: 2.0),
            min=0, max=5, step=0.5, unit="days a week", decimals=1,
            help="Full-price Zurich day tariffs: CHF 138 before 18 months, CHF 120 after. City subsidies are not included.",
        ),
        Question(
            "childcare_start", "number", "Childcare starts", "How many months after the birth would childcare start?",
            "couple", "decision", read=_child_attr("childcare_start_months_after_birth", lambda plan: 4),
            min=0, max=48, step=1, unit="months after birth", integer=True,
        ),
        Question(
            "extra_leave", "choice", "More time at home",
            "After the statutory leave, will either of you take more time off or work less for a while?",
            "couple", "responsibilities",
            read=lambda plan: _child_break(plan)[0] or "none",
            options=(
                Option("none", "No, we both go back after the statutory leave", ("no", "none", "both go back", "neither")),
                Option("first", "{first} takes more time", ()),
                Option("second", "{second} takes more time", ()),
            ),
        ),
        Question(
            "extra_leave_months", "number", "Length of the extra time", "For how many months?",
            "couple", "responsibilities", applies=lambda v: v.get("extra_leave") in ("first", "second"),
            read=lambda plan: (_child_break(plan)[1].months if _child_break(plan)[1] else 6),
            min=1, max=24, step=1, unit="months", integer=True,
        ),
        Question(
            "extra_leave_income", "number", "Pay during the extra time",
            "How much of their usual pay would they keep during that time? Use 0% if it is unpaid.",
            "couple", "responsibilities", applies=lambda v: v.get("extra_leave") in ("first", "second"),
            read=lambda plan: (_child_break(plan)[1].income_pct if _child_break(plan)[1] else 0.0),
            min=0, max=100, step=10, unit="% of usual pay",
        ),
        Question(
            "cover_each_other", "bool", "Cover each other",
            "While one of you earns less, should household contributions follow what each of you actually earns?",
            "couple", "responsibilities", path="shared.split.adjust_for_breaks",
            help="If yes, the partner who keeps working pays a larger share of joint costs during leave.",
        ),
        *_split_questions(),
        Question(
            "priority", "choice", "What matters most", "What matters most to you in planning for a child?",
            "couple", "priorities", per_partner=True, topic="Priority",
            options=(
                Option("time", "Time at home with our child", ("time", "home", "together")),
                Option("savings", "Keeping my savings safe", ("save", "savings", "safe")),
                Option("career", "Keeping my career on track", ("career", "work", "job")),
                Option("costs", "Keeping childcare costs manageable", ("cost", "childcare", "kita", "cheap")),
            ),
        ),
        Question(
            "timing_flex", "choice", "Timing", "Is the timing fixed for you, or could it move if the plan needed it?",
            "couple", "priorities", per_partner=True, topic="Timing",
            options=(
                Option("fixed", "The timing matters to me", ("fixed", "matters", "important", "no"), "firm"),
                Option("flexible", "It could move by a year or so", ("flexible", "move", "later", "yes"), "flexible"),
            ),
        ),
        Question("everyday_cost", "chf", "Everyday child costs", "Everyday costs per month, including health insurance",
                 "details", "assumptions", read=_child_attr("everyday_cost_monthly", lambda plan: 700.0),
                 min=0, max=10_000, step=50, unit="/month",
                 help="An editable estimate. Zurich discontinued its child-cost table in 2026."),
        Question("childcare_until", "number", "Childcare ends", "At what age would childcare stop?",
                 "details", "assumptions", read=_child_attr("childcare_until_age", lambda plan: 4),
                 min=0, max=4, step=1, unit="years old", integer=True,
                 help="The model covers Kita until kindergarten age (4). School-age care is not included."),
        Question("allowance_recipient", "partner", "Family allowance paid to", "Who receives the family allowance?",
                 "details", "responsibilities",
                 read=lambda plan: (_target_child(plan).allowance_recipient if _target_child(plan) else _first(plan)),
                 suggest=lambda plan, v: v.get("birth_parent"),
                 help="CHF 215 a month until the 12th birthday month, then CHF 268."),
    ),
    compile=_child_compile,
    remove=_child_remove,
    headline=lambda plan, v: f"Child in {M.label(v['birth'])}, {float(v['childcare_days']):g} Kita days a week",
    notes=_child_notes,
)

def _career_entry(plan: Plan, pid: str):
    return next((b for b in plan.person(pid).career_breaks if not b.id.startswith("cb-child-")), None)


def _career_value(key: str, default):
    def suggest(plan: Plan, values: Values):
        entry = _career_entry(plan, values["person"])
        return getattr(entry, key) if entry else default(plan)
    return suggest


def _career_compile(plan: Plan, values: Values) -> list[Change]:
    pid = values["person"]
    person = plan.person(pid)
    existing = _career_entry(plan, pid)
    bid = existing.id if existing else "planner-break"
    entry = dict(id=bid, start=values["start"], months=int(values["months"]),
                 income_pct=values["income_kept"] * 100, one_off_cost_chf=values["break_cost"],
                 label=existing.label if existing else "Career break")
    breaks = [entry if b.id == bid else b.model_dump() for b in person.career_breaks]
    if existing is None:
        breaks.append(entry)
    return [Change(path=f"people.{pid}.career_breaks", value=breaks)]


def _support_changes(answer: str) -> list[Change]:
    changes = [Change(path="shared.split.adjust_for_breaks", value=answer != "no")]
    if answer != "no":
        changes.append(Change(path="shared.split.break_support_share", value=0.5 if answer == "some" else 1))
    return changes


CAREER_BREAK = DecisionModule(
    id="career-break",
    title="Take a career break",
    promise="Plan time away from work and see what it would take to keep both partners financially safe.",
    active=lambda plan: any(_career_entry(plan, p.id) for p in plan.people),
    questions=(
        Question("person", "partner", "Who takes the break", "Who is planning time away from work?",
                 "intention", "decision", suggest=lambda plan, v: next(
                     (p.id for p in plan.people if _career_entry(plan, p.id)), plan.people[1].id)),
        Question("start", "month", "Break starts", "When would the break start?", "intention", "decision",
                 suggest=_career_value("start", lambda plan: M.add(plan.assumptions.start, 12))),
        Question("months", "number", "Break length", "How many months would you take?", "intention", "decision",
                 suggest=_career_value("months", lambda plan: 12), min=1, max=36, step=1, unit="months", integer=True),
        Question("income_kept", "share", "Income kept", "How much of your usual net pay would you keep during the break?",
                 "intention", "decision", suggest=lambda plan, v: _career_value("income_pct", lambda plan: 0)(plan, v) / 100,
                 min=0, max=1, step=0.05),
        Question("break_cost", "chf", "One-off costs", "What would you pay at the start, such as course fees?",
                 "intention", "decision", suggest=_career_value("one_off_cost_chf", lambda plan: 0), min=0, step=100),
        Question("why_break", "text", "Why it matters", "What would this break give you?",
                 "couple", "priorities", per_partner=True, topic="Why it matters", role="taker"),
        Question("break_date_flex", "choice", "Break timing", "Could you start the break later?",
                 "couple", "priorities", per_partner=True, topic="Break timing", role="taker",
                 options=(Option("fixed", "The start month is essential", ("firm", "no"), "firm"),
                          Option("flexible", "I could start later", ("flexible", "yes"), "flexible"))),
        Question("part_time", "choice", "Part-time work", "Would part-time work during the break be acceptable?",
                 "couple", "priorities", per_partner=True, topic="Part-time work", role="taker",
                 options=(Option("yes", "I could work part-time", ("yes",), "flexible"),
                          Option("no", "I need to stop working", ("no",), "firm"))),
        Question("cover_more", "choice", "Extra household support", "Would you cover more of the shared costs during the break?",
                 "couple", "responsibilities", per_partner=True, topic="Household support", role="partner",
                 options=(Option("yes", "Yes, in proportion to our income during the break", ("yes",), "flexible"),
                          Option("some", "Some, halfway toward the income-based split", ("some",), "flexible"),
                          Option("no", "Keep our usual split", ("no",), "firm"))),
    ),
    compile=_career_compile,
    remove=lambda plan: [],
    headline=lambda plan, v: f"{plan.person(v['person']).name} takes {int(v['months'])} months from {M.label(v['start'])}",
    notes=lambda plan, v: ["Income and one-off costs are based on the amounts you enter."],
)


MODULES: dict[str, DecisionModule] = {m.id: m for m in (MOVE_IN, BUY_HOME, HAVE_CHILD, CAREER_BREAK)}


def module(mid: str) -> DecisionModule:
    try:
        return MODULES[mid]
    except KeyError:
        raise AnswerError(f"unknown decision '{mid}'") from None


# --------------------------------------------------------------------------- answers


def _same(a: Any, b: Any) -> bool:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and not isinstance(b, bool):
        return abs(float(a) - float(b)) < 1e-9
    return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)


def fmt(q: Question, v: Any, plan: Plan) -> str:
    if v is None:
        return "—"
    if q.kind == "month":
        return M.label(v)
    if q.kind == "chf":
        return _chf(v) + ("/month" if q.unit == "/month" else "")
    if q.kind == "share":
        return f"{float(v) * 100:.{q.decimals}f}%"
    if q.kind == "number":
        text = f"{float(v):.{q.decimals}f}".rstrip("0").rstrip(".") if q.decimals else f"{float(v):.0f}"
        return f"{text}{'' if q.unit.startswith('%') else ' '}{q.unit}".strip()
    if q.kind == "choice":
        opt = next((o for o in q.options if o.value == v), None)
        return _render(opt.label, plan) if opt else str(v)
    if q.kind == "partner":
        return next((p.name for p in plan.people if p.id == v), str(v))
    if q.kind == "bool":
        return "Yes" if v else "No"
    return str(v)


def coerce(q: Question, v: Any, plan: Plan) -> Any:
    """Validate one answer against its question. Raises ``AnswerError``."""
    if v is None:
        return None
    label = _render(q.label, plan)
    if q.kind == "month":
        if not isinstance(v, str) or not MONTH_RE.match(v):
            raise AnswerError(f"{label}: use a month like 2028-04.")
        start = plan.assumptions.start
        if M.index(v, start) < 0:
            raise AnswerError(f"{label}: choose {M.label(start)} or later.")
        if M.index(v, start) > 240:
            raise AnswerError(f"{label}: choose a month within 20 years.")
        return v
    if q.kind in ("chf", "share", "number"):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(float(v)):
            raise AnswerError(f"{label}: enter a number.")
        v = float(v)
        if q.min is not None and v < q.min - 1e-9:
            raise AnswerError(f"{label}: at least {fmt(q, q.min, plan)}.")
        if q.max is not None and v > q.max + 1e-9:
            raise AnswerError(f"{label}: at most {fmt(q, q.max, plan)}.")
        if q.integer:
            v = float(round(v))
        return round(v, 6)
    if q.kind == "choice":
        if v not in [o.value for o in q.options]:
            raise AnswerError(f"{label}: choose one of the options.")
        return v
    if q.kind == "partner":
        if v not in [p.id for p in plan.people]:
            raise AnswerError(f"{label}: choose one of you.")
        return v
    if q.kind == "bool":
        if not isinstance(v, bool):
            raise AnswerError(f"{label}: answer yes or no.")
        return v
    if not isinstance(v, str):
        raise AnswerError(f"{label}: enter text.")
    return v.strip()[:300]


def _known(m: DecisionModule, q: Question, plan: Plan, values: Values) -> bool:
    if m.id == "career-break" and not q.per_partner:
        return bool(_career_entry(plan, values["person"])) if "person" in values else m.active(plan)
    if q.per_partner or (q.read is None and q.path is None):
        return False
    return bool(q.known_when(plan)) if q.known_when else m.active(plan)


def resolve(m: DecisionModule, plan: Plan, session: DecisionSession) -> tuple[Values, dict[str, str]]:
    """Current value and source for every plan question (answer > agreed plan > suggestion)."""
    values: Values = {}
    sources: dict[str, str] = {}
    for q in m.questions:
        if q.per_partner:
            continue
        if q.id in session.answers:
            values[q.id], sources[q.id] = session.answers[q.id], "answer"
        elif _known(m, q, plan, values):
            values[q.id], sources[q.id] = (q.suggest(plan, values) if m.id == "career-break" else q.current(plan)), "plan"
        else:
            values[q.id] = q.suggest(plan, values) if q.suggest else q.current(plan)
            sources[q.id] = q.source if q.stage == "details" else "suggested"
    return values, sources


def compile_changes(m: DecisionModule, plan: Plan, session: DecisionSession, values: Values | None = None
                    ) -> tuple[list[Change], list[str]]:
    """Validated changes that turn the agreed plan into the plan described by the answers."""
    if values is None:
        values, _ = resolve(m, plan, session)
    raw: list[Change] = []
    for q in m.questions:
        if q.path and not q.per_partner and _applies(q, values):
            raw.append(Change(path=q.path, value=values[q.id]))
    raw += m.compile(plan, values)
    if m.id == "career-break" and _shared_known(plan):
        other = next(p.id for p in plan.people if p.id != values["person"])
        support = session.preferences.get("cover_more", {}).get(other)
        if support:
            raw += _support_changes(support)
    raw += session.adjustments
    latest: dict[str, Change] = {}
    for ch in raw:
        latest.pop(ch.path, None)
        latest[ch.path] = ch
    changes = []
    for ch in latest.values():
        try:
            old = get_value(plan, ch.path)
        except ChangeError:
            changes.append(ch)
        else:
            if not _same(old, ch.value):
                changes.append(ch)
    try:
        apply_changes(plan, changes)
    except ChangeError as e:
        return changes, [_friendly(str(e))]
    return changes, []


def _friendly(error: str) -> str:
    if "overlap" in error:
        return "The extra time off overlaps a career break that is already in the plan. Change its length or the birth month."
    return error.replace("invalid plan after changes: ", "")


def _answers_for(q: Question, values: Values, viewer: str) -> bool:
    if q.role == "taker":
        return viewer == values["person"]
    if q.role == "partner":
        return viewer != values["person"]
    return True


def pending(m: DecisionModule, plan: Plan, session: DecisionSession, viewer: str, values: Values) -> list[Question]:
    """Questions still open for this viewer, in asking order (plan questions first)."""
    plan_qs, prefs = [], []
    for q in m.questions:
        if q.stage == "details" or not _applies(q, values):
            continue
        if q.per_partner:
            if _answers_for(q, values, viewer) and viewer not in session.preferences.get(q.id, {}):
                prefs.append(q)
        elif q.id not in session.answers and not _known(m, q, plan, values):
            plan_qs.append(q)
    order = {"intention": 0, "couple": 1}
    return sorted(plan_qs, key=lambda q: order[q.stage]) + prefs


def apply_answers(m: DecisionModule, plan: Plan, session: DecisionSession, viewer: str,
                  answers: dict[str, Any], preferences: dict[str, Any]) -> list[str]:
    """Merge validated answers into the session. Returns ids that changed the plan."""
    if viewer not in [p.id for p in plan.people]:
        raise AnswerError("unknown partner")
    changed = []
    for qid, value in answers.items():
        q = m.question(qid)
        if q.per_partner:
            raise AnswerError(f"{_render(q.label, plan)} is a personal preference; each partner answers it.")
        value = coerce(q, value, plan)
        if value is None:
            session.answers.pop(qid, None)
            session.answered_by.pop(qid, None)
        else:
            session.answers[qid] = value
            session.answered_by[qid] = viewer
        changed.append(qid)
    values, _ = resolve(m, plan, session)
    for qid, value in preferences.items():
        q = m.question(qid)
        if not q.per_partner:
            raise AnswerError(f"{_render(q.label, plan)} is not a personal preference.")
        value = coerce(q, value, plan)
        if not _answers_for(q, values, viewer):
            raise AnswerError("This question is for the other partner.")
        mine = session.preferences.setdefault(qid, {})
        if value is None:
            mine.pop(viewer, None)
        else:
            mine[viewer] = value
    session.updated_at = _now()
    session.updated_by = viewer
    return changed


def absorb(m: DecisionModule, plan: Plan, session: DecisionSession, viewer: str, changes: list[Change]) -> None:
    """Take validated changes (e.g. a verified alternative) into the session.

    Changes that address a question's own path update that answer, so the brief
    shows them. Everything else is kept as an explicit adjustment.
    """
    by_path = {q.path: q for q in m.questions if q.path and not q.per_partner}
    rest: list[Change] = []

    def record(answers: dict) -> None:
        apply_answers(m, plan, session, viewer, answers, {})

    compiled, errors = compile_changes(m, plan, session)
    new_break_paths = {c.path for c in compiled if c.path.endswith(".career_breaks")}
    touches_new_break = any(any(c.path.startswith(path + ".") for path in new_break_paths) for c in changes)
    edited = apply_changes(apply_changes(plan, compiled) if touches_new_break and not errors else plan, changes)
    for ch in changes:
        parts = ch.path.split(".")
        if m.id == "career-break" and len(parts) >= 3 and parts[0] == "people" and parts[2] == "career_breaks":
            pid = parts[1]
            original = {b.id: b for b in plan.person(pid).career_breaks}
            updated = edited.person(pid).career_breaks
            changed = [b for b in updated if b != original.get(b.id)]
            if len(changed) == 1:
                b = changed[0]
                record(dict(person=pid, start=b.start, months=b.months, income_kept=b.income_pct / 100,
                            break_cost=b.one_off_cost_chf))
                entry = _career_entry(plan, pid)
                if entry is None and len(updated) == len(original) + 1:
                    continue
                if entry is not None and b.id == entry.id and len(updated) == len(original):
                    continue
        if m.id == "have-child" and ch.path == "shared.children" and edited.shared.children:
            child = next((c for c in edited.shared.children if c not in plan.shared.children), edited.shared.children[0])
            record(dict(birth=child.birth, birth_parent=child.leave.birth_parent, childcare_days=child.childcare_days_per_week,
                        childcare_start=child.childcare_start_months_after_birth, childcare_until=child.childcare_until_age,
                        everyday_cost=child.everyday_cost_monthly, allowance_recipient=child.allowance_recipient))
        q = by_path.get(ch.path)
        if q is not None:
            session.answers[q.id] = coerce(q, ch.value, plan)
            session.answered_by[q.id] = viewer
        else:
            rest.append(ch)
    session.adjustments = rest
    _, errors = compile_changes(m, plan, session)
    if errors:
        raise ChangeError(errors[0])


# --------------------------------------------------------------------------- offline reading of free text

SEASONS = {"spring": "04", "summer": "07", "autumn": "10", "fall": "10", "winter": "01", "beginning": "01",
           "start": "01", "end": "12", "mid": "06", "middle": "06"}


def parse_offline(q: Question, text: str, plan: Plan, viewer: str) -> Any:
    """Best-effort reading of one answer from free text; ``None`` when unclear."""
    from converge.ai import NUM_WORDS, _num, _when

    t = text.lower().strip()
    if q.kind == "month":
        found = _when(t, int(plan.assumptions.start[:4]))
        if found:
            return found
        m = re.search(r"\b(spring|summer|autumn|fall|winter|beginning|start|end|mid|middle)\b[^0-9]{0,12}(20\d\d)\b", t)
        if m:
            return f"{m.group(2)}-{SEASONS[m.group(1)]}"
        m = re.search(r"\b(20\d\d)\b", t)
        return f"{m.group(1)}-01" if m else None
    if q.kind == "chf":
        t2 = re.sub(r"\b(million|mio)\b", "m", t)
        m = re.search(r"(\d[\d’',.]*\s*[km]?)\b", t2)
        if not m:
            return None
        try:
            return _num(m.group(1).replace(" ", ""))
        except ValueError:
            return None
    if q.kind == "share":
        m = re.search(r"(\d+)\s*/\s*(\d+)", t)
        if m and float(m.group(1)) + float(m.group(2)) == 100:
            return float(m.group(1)) / 100
        m = re.search(r"(\d+(?:\.\d+)?)\s*%", t)
        if m:
            return float(m.group(1)) / 100
        if re.search(r"\b(half|equal|equally|evenly)\b", t):
            return 0.5
        return None
    if q.kind == "number":
        m = re.search(r"(\d+(?:\.\d+)?)", t)
        if m:
            return float(m.group(1))
        for word, n in NUM_WORDS.items():
            if re.search(rf"\b{word}\b", t) and word not in ("a", "an"):
                return float(n)
        return None
    if q.kind == "choice":
        names = {o.value: _render(o.label, plan).lower() for o in q.options}
        scores = {}
        for o in q.options:
            words = list(o.keywords)
            if o.value in ("first", "second"):
                words.append(plan.people[0 if o.value == "first" else 1].name.lower())
            scores[o.value] = sum(1 for w in words if re.search(rf"\b{re.escape(w)}", t)) + (3 if names[o.value] in t else 0)
        best = max(scores.values(), default=0)
        winners = [v for v, s in scores.items() if s == best]
        return winners[0] if best > 0 and len(winners) == 1 else None
    if q.kind == "partner":
        hits = [p.id for p in plan.people if re.search(rf"\b{re.escape(p.name.lower())}\b", t)]
        if len(hits) == 1:
            return hits[0]
        if re.search(r"\b(me|i|myself)\b", t):
            return viewer
        return None
    if q.kind == "bool":
        if re.search(r"\b(yes|yeah|sure|ok|okay|agree|should)\b", t):
            return True
        if re.search(r"\b(no|nope|not|shouldn't)\b", t):
            return False
        return None
    return text.strip()[:300] or None


# --------------------------------------------------------------------------- state for the API


def _question_view(m: DecisionModule, q: Question, plan: Plan, session: DecisionSession, values: Values,
                   sources: dict[str, str], ctx: dict) -> dict:
    help_text = q.help(plan, ctx) if callable(q.help) else q.help
    out = dict(
        id=q.id, kind=q.kind, label=_render(q.label, plan), prompt=_render(q.prompt, plan), stage=q.stage,
        group=q.group, help=_render(help_text, plan), per_partner=q.per_partner, topic=q.topic,
        options=[dict(value=o.value, label=_render(o.label, plan), stance=o.stance) for o in q.options],
        min=q.min, max=q.max, step=q.step, unit=q.unit, decimals=q.decimals,
        applies=_applies(q, values),
    )
    if q.per_partner:
        answers = session.preferences.get(q.id, {})
        out["answers"] = {pid: dict(value=v, text=fmt(q, v, plan)) for pid, v in answers.items()}
    else:
        v = values[q.id]
        out.update(value=v, value_text=fmt(q, v, plan), source=sources[q.id], by=session.answered_by.get(q.id),
                   amount_base=m.amount_base(q.id, values, ctx.get("eval")))
    return out


def _brief(m: DecisionModule, plan: Plan, session: DecisionSession, values: Values, sources: dict[str, str],
           viewer: str) -> dict:
    partners = []
    flexible, firm, differences = [], [], []
    for p in plan.people:
        prefs, parts = [], []
        for q in m.questions:
            if not q.per_partner or not _applies(q, values) or not _answers_for(q, values, p.id):
                continue
            v = session.preferences.get(q.id, {}).get(p.id)
            opt = next((o for o in q.options if o.value == v), None)
            prefs.append(dict(id=q.id, topic=q.topic, value=v, text=fmt(q, v, plan) if v is not None else None,
                              stance=opt.stance if opt else None))
            if q.kind == "text" and v:
                parts.append(str(v))
            if opt:
                parts.append(_render(opt.label, plan))
                if opt.stance == "flexible":
                    flexible.append(f"{q.topic} · {p.name}: {_render(opt.label, plan)}")
                elif opt.stance == "firm":
                    firm.append(f"{q.topic} · {p.name}: {_render(opt.label, plan)}")
        summary = "; ".join(parts) if parts else None
        partners.append(dict(id=p.id, name=p.name, preferences=prefs, summary=summary,
                             complete=all(x["value"] is not None for x in prefs)))
    for q in m.questions:
        if not q.per_partner or not _applies(q, values) or q.topic == "Priority":
            continue
        answers = session.preferences.get(q.id, {})
        stances = {pid: next((o.stance for o in q.options if o.value == v), None) for pid, v in answers.items()}
        if len(answers) == 2 and len(set(answers.values())) == 2 and set(stances.values()) & {"firm"}:
            a, b = plan.people
            differences.append(f"{q.topic}: you see this differently. {a.name}: {fmt(q, answers.get(a.id), plan)}. "
                               f"{b.name}: {fmt(q, answers.get(b.id), plan)}.")

    missing = []
    for q in pending(m, plan, session, viewer, values):
        if not q.per_partner:
            missing.append(f"{_render(q.label, plan)} is not confirmed yet.")
    for p in partners:
        open_ = [x["topic"].lower() for x in p["preferences"] if x["value"] is None]
        if open_:
            missing.append(f"{p['name']} hasn't shared their view on {', '.join(open_)} yet.")

    items = []
    for q in m.questions:
        if q.per_partner or not _applies(q, values):
            continue
        items.append(dict(id=q.id, group=q.group, label=_render(q.label, plan), value_text=fmt(q, values[q.id], plan),
                          source=sources[q.id], by=session.answered_by.get(q.id)))
    uncertain = [f"{x['label']}: {x['value_text']}" for x in items
                 if x["group"] == "assumptions" and x["source"] in ("assumption", "suggested")]
    return dict(
        title=m.title, summary=m.headline(plan, values), items=items, partners=partners,
        flexible=flexible, firm=firm, differences=differences, missing=missing,
        uncertain=uncertain, limits=m.notes(plan, values),
    )


def _status(m: DecisionModule, plan: Plan, session: DecisionSession | None, proposal: dict | None,
            changes: list[Change]) -> str:
    if proposal and proposal.get("status") == "pending":
        return "proposed"
    if session is not None and (session.answers or session.preferences) and changes:
        return "in_progress"
    if m.active(plan):
        return "in_plan"
    return "in_progress" if session is not None and (session.answers or session.preferences) else "not_started"


def state(m: DecisionModule, plan: Plan, session: DecisionSession, viewer: str, proposal: dict | None = None) -> dict:
    from converge.engine.changes import required_approvers
    from converge.engine.evaluate import evaluate

    values, sources = resolve(m, plan, session)
    changes, errors = compile_changes(m, plan, session, values)
    ev = None
    if not errors:
        try:
            ev = evaluate(apply_changes(plan, changes))
        except ChangeError:
            ev = None
    ctx = dict(values=values, eval=ev)
    open_qs = pending(m, plan, session, viewer, values)
    plan_open = [q for q in m.questions if not q.per_partner and q.stage != "details" and _applies(q, values)
                 and q.id not in session.answers and not _known(m, q, plan, values)]
    asked = [q for q in m.questions if q.stage != "details" and _applies(q, values) and _answers_for(q, values, viewer)]
    stage = next((q.stage for q in open_qs), "review")
    described = []
    for ch in changes:
        d = describe(plan, ch)
        described.append(dict(**d.model_dump(), previous_text=format_value(d.unit, d.previous),
                              value_text=format_value(d.unit, d.value)))
    nxt = open_qs[0] if open_qs else None
    return dict(
        module=dict(id=m.id, title=m.title, promise=m.promise),
        status=_status(m, plan, session, proposal, changes),
        active=m.active(plan),
        stage=stage,
        questions=[_question_view(m, q, plan, session, values, sources, ctx) for q in m.questions],
        next=dict(id=nxt.id, prompt=_render(nxt.prompt, plan), source="deterministic") if nxt else None,
        pending=[q.id for q in open_qs],
        ready=not plan_open and not errors,
        progress=dict(done=len(asked) - len(open_qs), total=len(asked)),
        brief=_brief(m, plan, session, values, sources, viewer),
        changes=[c.model_dump() for c in changes],
        described=described,
        approvers=([p.id for p in plan.people] if m.id == "career-break" else required_approvers(plan, changes)) if changes else [],
        errors=errors,
        adjustments=[c.model_dump() for c in session.adjustments],
        proposal=proposal,
        updated_at=session.updated_at if (session.answers or session.preferences) else None,
        updated_by=session.updated_by,
    )


def summary(m: DecisionModule, plan: Plan, session: DecisionSession | None, proposal: dict | None) -> dict:
    s = session or DecisionSession(module=m.id)
    values, _ = resolve(m, plan, s)
    changes, _ = compile_changes(m, plan, s, values)
    status = _status(m, plan, session, proposal, changes)
    asked = [q for q in m.questions if q.stage != "details" and _applies(q, values)]
    answered = sum(1 for q in asked if (q.per_partner and all(p.id in s.preferences.get(q.id, {})
                                                         for p in plan.people if _answers_for(q, values, p.id)))
                   or (not q.per_partner and (q.id in s.answers or _known(m, q, plan, values))))
    headline = m.headline(plan, values) if status != "not_started" else None
    return dict(id=m.id, title=m.title, promise=m.promise, status=status, headline=headline,
                progress=dict(done=answered, total=len(asked)), proposal_id=s.proposal_id)


# --------------------------------------------------------------------------- assistant context


def intake_context(m: DecisionModule, plan: Plan, session: DecisionSession, viewer: str) -> dict:
    """Facts given to the language model. It sees questions and answers, never results."""
    values, sources = resolve(m, plan, session)
    open_ids = [q.id for q in pending(m, plan, session, viewer, values)]
    me = plan.person(viewer)
    other = next(p for p in plan.people if p.id != viewer)
    questions = []
    for q in m.questions:
        if not _applies(q, values) or not _answers_for(q, values, viewer):
            continue
        item = dict(id=q.id, kind=q.kind, label=_render(q.label, plan), prompt=_render(q.prompt, plan),
                    per_partner=q.per_partner, open=q.id in open_ids, stage=q.stage,
                    options=[dict(value=o.value, label=_render(o.label, plan)) for o in q.options] or None,
                    min=q.min, max=q.max, unit=q.unit or None)
        if q.per_partner:
            mine = session.preferences.get(q.id, {}).get(viewer)
            item["viewer_answer"] = fmt(q, mine, plan) if mine is not None else None
        else:
            item["current"] = fmt(q, values[q.id], plan)
            item["confirmed"] = sources[q.id] in ("answer", "plan")
        questions.append(item)
    return dict(
        decision=m.title, today="2026-11", plan_start=plan.assumptions.start,
        plan_end=M.add(plan.assumptions.start, plan.assumptions.horizon_months - 1),
        viewer=dict(id=me.id, name=me.name), partner=dict(id=other.id, name=other.name),
        partners=[dict(id=p.id, name=p.name) for p in plan.people],
        open_questions=open_ids, questions=questions,
    )


def take_turn(m: DecisionModule, plan: Plan, session: DecisionSession, viewer: str, text: str | None,
              focus: str | None, ask_next: bool) -> dict:
    """Read a free-text answer and choose the next question.

    With a language model: it extracts answers and phrases the next question;
    every extracted value is validated like a form answer, preferences are only
    accepted for the viewer, and the wording must not introduce numbers that are
    not in the context. Without one: the built-in parser reads the focused
    question only and the next question follows the module's fixed order.
    """
    from converge import ai

    meta: dict = dict(mode="offline", extracted=[], rejected=[], ambiguities=[], next=None)
    if not text and not ask_next:
        return meta
    context = intake_context(m, plan, session, viewer)
    data, info = ai.decision_intake(context, text)
    meta.update(info)

    if data is None:
        if text:
            values, _ = resolve(m, plan, session)
            open_qs = pending(m, plan, session, viewer, values)
            q = next((x for x in m.questions if x.id == focus), None) or (open_qs[0] if open_qs else None)
            value = parse_offline(q, text, plan, viewer) if q else None
            if q is None:
                meta["ambiguities"].append("Every question is answered. Edit an item in the brief to change it.")
            elif value is None:
                meta["ambiguities"].append(f"I couldn't read an answer to “{_render(q.prompt, plan)}” from that. "
                                           "Use the field above, or say it another way.")
            else:
                _take(m, plan, session, viewer, q, value, meta)
        return meta

    for a in data.answers:
        try:
            q = m.question(a.question_id)
        except AnswerError:
            meta["rejected"].append(f"'{a.question_id}' is not part of this decision.")
            continue
        if q.per_partner and a.partner_id not in (None, viewer):
            name = next((p.name for p in plan.people if p.id == a.partner_id), "your partner")
            meta["rejected"].append(f"Only {name} can share {name}'s view on {q.topic.lower()}.")
            continue
        value = next((x for x in (a.number, a.text, a.flag) if x is not None), None)
        if q.kind == "chf" and isinstance(value, str):
            value = None
        if value is None:
            continue
        _take(m, plan, session, viewer, q, value, meta)
    meta["ambiguities"] += [s.strip() for s in data.ambiguities if s.strip()][:3]

    values, _ = resolve(m, plan, session)
    open_ids = [q.id for q in pending(m, plan, session, viewer, values)]
    if data.next_question_id in open_ids and data.next_question:
        wording = data.next_question.strip()
        facts = intake_context(m, plan, session, viewer)
        if 0 < len(wording) <= 400 and ai.grounded(wording, facts)[0]:
            meta["next"] = dict(id=data.next_question_id, prompt=wording, source="llm")
    return meta


def _take(m: DecisionModule, plan: Plan, session: DecisionSession, viewer: str, q: Question, value: Any, meta: dict) -> None:
    try:
        if q.per_partner:
            apply_answers(m, plan, session, viewer, {}, {q.id: value})
        else:
            apply_answers(m, plan, session, viewer, {q.id: value}, {})
    except AnswerError as e:
        meta["rejected"].append(str(e))
        return
    stored = session.preferences[q.id][viewer] if q.per_partner else session.answers[q.id]
    meta["extracted"].append(dict(question_id=q.id, label=_render(q.label, plan), value_text=fmt(q, stored, plan)))
