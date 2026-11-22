"""Replay docs/demo.md against the engine using the two UBS demo profiles."""

from converge.engine.changes import apply_changes
from converge.engine.evaluate import chf, evaluate
from converge.engine.recommend import recommend
from converge.models import Change
from converge.seed import default_plan


def main() -> None:
    nina_id, emil_id = "P00918", "P00809"
    base = default_plan((nina_id, emil_id))
    initial = evaluate(base)
    assert base.assumptions.tax_rate == 0 and initial["status"] == "on_track"
    assert all(not any(series["tax"]) for series in initial["series"].values())
    nina, emil = initial["people"]
    print(f"Opening cash: Nina {chf(nina['start_cash'])}, Emil {chf(emil['start_cash'])}")

    home = apply_changes(base, [
        Change(path="shared.household.enabled", value=True),
        Change(path="shared.property.enabled", value=True),
    ])
    bought = evaluate(home)
    affordability = bought["property"]["affordability"]
    assert bought["status"] == "on_track" and affordability["passes"]
    print(f"Home: {chf(home.shared.property.price)}, {home.shared.property.purchase}, "
          f"{affordability['ratio']:.1%} of usual net income")

    draft = apply_changes(home, [
        Change(path=f"people.{emil_id}.career_breaks", value=[
            dict(id="cb1", start="2028-01", months=12, income_pct=0, one_off_cost_chf=8000),
        ]),
    ])
    conflict = evaluate(draft)
    issue, = (i for i in conflict["issues"] if i["severity"] == "hard")
    assert conflict["status"] == "conflict" and issue["id"] == f"floor:{emil_id}"
    assert issue["amount_chf"] > 20_000 and conflict["people"][0]["headroom"] > 0
    print(f"Break: Emil breaches in {issue['month']} and is {chf(issue['amount_chf'])} short "
          f"in {issue['worst_month']}; Nina has {chf(conflict['people'][0]['headroom'])} headroom")

    result = recommend(draft)
    options = result["recommendations"]
    assert len(options) == 3
    print(f"Recommendations: {result['evaluated']} candidates evaluated")
    for option in options:
        assert option["verified"]
        print(f"  {option['strategy_title']}: {option['title']}")

    selected = next(option for option in options if option["strategy"] == "speed")
    revised = apply_changes(draft, [Change(**change) for change in selected["raw_changes"]])
    fixed = evaluate(revised)
    assert fixed["checks"]["ok"] and fixed["status"] == "on_track"
    print(f"After {selected['strategy_title']}: Emil has {chf(fixed['people'][1]['headroom'])} headroom")

    stress = apply_changes(revised, [Change(path="shared.property.mortgage_rate", value=0.04)])
    stressed = evaluate(stress)
    issue, = (i for i in stressed["issues"] if i["severity"] == "hard")
    assert stressed["status"] == "conflict" and issue["id"] == f"floor:{emil_id}"
    fixes = recommend(stress)["recommendations"]
    assert fixes and all(option["verified"] for option in fixes)
    print(f"4% stress: Emil breaches in {issue['month']} and is {chf(issue['amount_chf'])} short "
          f"in {issue['worst_month']}; {len(fixes)} verified recommendations")


if __name__ == "__main__":
    main()
