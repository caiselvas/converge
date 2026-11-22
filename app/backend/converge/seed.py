"""Default workspace: two independent UBS synthetic profiles, not yet linked.

The relationship between the two partners is a scenario assumption — the
profiles are unrelated records in the UBS dataset.
"""
from __future__ import annotations

import math

from converge import config
from converge.data.profiles import build_person
from converge.models import Household, Plan, Property, Shared, Split


def _round(x: float, step: float) -> float:
    return math.ceil(x / step) * step


def default_shared(plan_people) -> Shared:
    a, b = plan_people

    def cat(p, key):
        return next((c.budget_monthly for c in p.categories if c.key == key), 0.0)

    groceries = cat(a, "groceries") + cat(b, "groceries")  # no economies of scale assumed
    utilities = _round(max(cat(a, "utilities"), cat(b, "utilities")) * 1.3, 10)
    return Shared(
        household=Household(enabled=False, move_in="2027-04", rent=3400, utilities=utilities,
                            groceries=round(groceries), moving_cost=3000),
        split=Split(mode="income"),
        property=Property(enabled=False),
    )


def default_plan(partners: tuple[str, str] | None = None) -> Plan:
    ids = partners or config.DEFAULT_PARTNERS
    people = [build_person(pid) for pid in ids[:2]]
    return Plan(people=people, shared=default_shared(people))
