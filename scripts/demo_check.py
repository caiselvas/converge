"""Replay docs/demo.md against the engine using the two UBS demo profiles."""

from time import perf_counter

from converge import decisions as D
from converge.engine.changes import apply_changes
from converge.engine.comparison import compare
from converge.engine.evaluate import chf, evaluate
from converge.engine.recommend import recommend
from converge.models import Change
from converge.seed import default_plan
from converge.store import prepared_home


def main() -> None:
    nina_id, emil_id = "P00918", "P00809"
    base = default_plan((nina_id, emil_id))
    initial = evaluate(base)
    assert base.assumptions.tax_rate == 0 and initial["status"] == "on_track"
    assert all(not any(series["tax"]) for series in initial["series"].values())
    nina, emil = initial["people"]
    print(f"Opening cash: Nina {chf(nina['start_cash'])}, Emil {chf(emil['start_cash'])}")

    home = prepared_home(base)
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


    goal = next(g for g in home.person(emil_id).goals if g.name == "Career transition")
    goal_changes = [
        Change(path=f"people.{emil_id}.goals.{goal.id}.target_chf", value=220_000),
        Change(path=f"people.{emil_id}.goals.{goal.id}.target_date", value="2030-12"),
    ]
    home_with_goal = evaluate(apply_changes(home, goal_changes))
    assert next(g for g in home_with_goal["people"][1]["goals"] if g["id"] == goal.id)["met"]
    goal_scenario = apply_changes(revised, goal_changes)
    outcome = evaluate(goal_scenario)
    goal_result = next(g for g in outcome["people"][1]["goals"] if g["id"] == goal.id)
    assert outcome["status"] == "attention" and 45_000 < goal_result["shortfall_chf"] < 50_000
    assert goal_result["reached_month"] == "2031-07"
    concessions = [r for r in recommend(goal_scenario)["recommendations"] if r["concession"]]
    assert concessions and all(r["verified"] for r in concessions)
    print(f"Optional career transition target: {chf(goal_result['shortfall_chf'])} short in "
          f"{goal_result['target_date']}, reached in {goal_result['reached_month']}; "
          f"{concessions[0]['title']}")


    child_plan = apply_changes(home, [Change(path="shared.children", value=[dict(
        id="child-1", label="Child 1", birth="2028-01", allowance_recipient=emil_id,
        leave=dict(birth_parent=nina_id, other_parent=emil_id),
    )])])
    child_eval = evaluate(child_plan)
    january = child_eval["months"].index("2028-01")
    may = child_eval["months"].index("2028-05")
    child = child_eval["children"][0]
    birth, kita = child["costs"][january], child["costs"][may]
    assert child_eval["checks"]["ok"] and birth["childcare"] == 0 and kita["childcare"] > 0
    assert child_eval["series"][emil_id]["family_allowance"][january] == birth["allowance"] > 0
    assert any(e["kind"] == "child_birth" and e["month"] == child["birth"] for e in child_eval["events"])
    print(f"Child scenario: {chf(birth['net_cost'])} net in {child['birth']}; "
          f"{chf(kita['net_cost'])} net in {child_eval['months'][may]} "
          f"(Kita {chf(kita['childcare'])}, allowance {chf(kita['allowance'])})")


    session = D.DecisionSession(module=D.CAREER_BREAK.id)
    D.apply_answers(D.CAREER_BREAK, home, session, emil_id,
                    dict(person=emil_id, start="2028-01", months=12, income_kept=0, break_cost=8000),
                    dict(why_break="Time to retrain", break_date_flex="flexible", part_time="yes"))
    D.apply_answers(D.CAREER_BREAK, home, session, nina_id, {}, {"cover_more": "no"})
    changes, errors = D.compile_changes(D.CAREER_BREAK, home, session)
    assert not errors and home.assumptions.horizon_months == 120
    your_plan = apply_changes(home, changes)
    before = your_plan.model_dump()
    prefs = {**session.preferences, "date_flex": {nina_id: "fixed"}}
    started = perf_counter()
    comparison = compare(your_plan, prefs)
    elapsed = perf_counter() - started
    your_option, *alternatives = comparison["columns"]
    assert not your_option["people"][1]["safe"] and not your_option["safe"]
    safe = [o for o in alternatives if o["safe"]]
    assert len({o["primary_lever"] for o in safe}) == len(safe) >= 2
    assert all(c["path"] != "shared.property.purchase" for o in safe for c in o["raw_changes"])
    assert all(o["robustness"]["mortgage"]["value"] > 0 and o["robustness"]["income"]["value"] > 0 for o in safe)
    assert all(any("keeps the home purchase month" in note for note in o["respects"]) for o in safe)
    print(f"Planner (120 months): {len(safe)} safe distinct options, firm home date, "
          f"{comparison['evaluated']} variants in {elapsed:.2f}s")
    for option in safe:
        limits = option["robustness"]
        print(f"  {option['title']} | {limits['mortgage']['value']:.1%} mortgage, "
              f"{limits['income']['value']:.1%} income drop")
    stress = compare(your_plan, prefs, {"mortgage_rate": 0.04})
    survivors = [o for o in stress["columns"] if o["safe"]]
    assert 0 < len(survivors) < len(safe)
    assert your_plan.model_dump() == before and home.shared.property.mortgage_rate == 0.018
    chosen = apply_changes(your_plan, [Change.model_validate(c) for c in survivors[0]["raw_changes"]])
    assert chosen.shared.property.mortgage_rate == home.shared.property.mortgage_rate
    assert evaluate(chosen)["status"] != "conflict"
    print(f"Planner at 4%: {len(survivors)}/{len(safe)} options still safe; "
          f"agreed mortgage assumption stays {home.shared.property.mortgage_rate:.1%}")


if __name__ == "__main__":
    main()
