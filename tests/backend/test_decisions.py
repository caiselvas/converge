"""Guided life decisions: answers -> validated changes -> engine -> approval workflow."""
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from converge import api, config
from converge import decisions as D
from converge.engine.changes import apply_changes
from converge.engine.evaluate import evaluate
from converge.store import Store


@pytest.fixture
def offline(monkeypatch):
    monkeypatch.setattr(config, "LLM_PROVIDER", "auto")
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(config, "OPENAI_API_KEY", "")


@pytest.fixture
def client(simple_plan, tmp_path, monkeypatch, offline):
    monkeypatch.setattr(api, "store", Store(path=str(tmp_path / "ws.json"), seed_factory=lambda: simple_plan))
    return TestClient(api.app)


def step(client, mid, viewer, **body):
    r = client.post(f"/api/decisions/{mid}/step", json={"viewer": viewer, **body})
    assert r.status_code == 200, r.text
    return r.json()


def test_catalogue_lists_three_decisions(client):
    ws = client.get("/api/workspace").json()
    assert [d["id"] for d in ws["decisions"]] == ["move-in", "buy-home", "have-child"]
    assert all(d["status"] == "not_started" for d in ws["decisions"])
    assert client.get("/api/decisions/retire-early?viewer=A").status_code == 404


def test_opening_a_decision_does_not_change_the_plan(client):
    before = client.get("/api/workspace").json()
    state = client.get("/api/decisions/buy-home?viewer=A").json()
    assert state["stage"] == "intention" and state["next"]["id"] == "price"
    assert not state["ready"]
    after = client.get("/api/workspace").json()
    assert after["plan"] == before["plan"] and after["versions"] == before["versions"]


def test_buy_home_end_to_end(client):
    s = step(client, "buy-home", "A", answers={"price": 900_000, "purchase": "2028-01", "target_date": "2028-06",
                                                "deposit_pct": 0.25, "ownership_share_first": 0.6,
                                                "move_before": "at_purchase", "split_mode": "equal"})
    assert s["ready"] and s["stage"] == "couple"  # only Ana's own preferences remain
    assert {q for q in s["pending"]} == {"priority", "date_flex", "budget_flex"}
    changes = {c["path"]: c["value"] for c in s["changes"]}
    assert changes["shared.property.enabled"] is True and changes["shared.household.enabled"] is True
    assert changes["shared.household.move_in"] == "2028-01"  # moving in when buying
    assert changes["shared.property.ownership_share_first"] == 0.6
    assert s["approvers"] == ["A", "B"]

    # Preferences: each partner answers for themselves, never for the other.
    step(client, "buy-home", "A", preferences={"priority": "safety", "date_flex": "year", "budget_flex": "lower"})
    s = step(client, "buy-home", "B", preferences={"date_flex": "fixed"})
    brief = s["brief"]
    assert any("Ben" in x and "essential" in x for x in brief["firm"])
    assert any("Ana" in x for x in brief["flexible"])
    assert brief["differences"]
    assert any("Ben hasn't shared" in x for x in brief["missing"])

    # The consequences come from the existing engine, on top of the agreed plan.
    sim = client.post("/api/simulate", json={"changes": s["changes"]}).json()
    assert sim["evaluation"]["property"]["price"] == 900_000
    assert sim["evaluation"]["checks"]["ok"] is True
    assert sim["base"]["property"] is None

    # Proposing goes through the normal approval workflow.
    p = client.post("/api/decisions/buy-home/propose", json={"author": "A"}).json()
    assert p["kind"] == "decision" and p["status"] == "pending"
    assert p["approvals"] == {"A": "approved", "B": "pending"}
    assert "Ana:" in p["note"]
    assert client.get("/api/workspace").json()["plan"]["shared"]["property"]["enabled"] is False
    summary = next(d for d in client.get("/api/decisions").json() if d["id"] == "buy-home")
    assert summary["status"] == "proposed"

    client.post(f"/api/proposals/{p['id']}/approve", json={"person": "B"})
    ws = client.get("/api/workspace").json()
    assert ws["plan"]["shared"]["property"]["price"] == 900_000
    state = client.get("/api/decisions/buy-home?viewer=B").json()
    assert state["status"] == "in_plan" and state["changes"] == []
    # Known facts are not asked again; only Ben's remaining preferences are open.
    assert set(state["pending"]) == {"priority", "budget_flex"}


def test_known_plan_values_are_not_asked_again(client, simple_plan):
    client.post("/api/proposals", json={"author": "A", "title": "Move in", "changes": [
        {"path": "shared.household.enabled", "value": True}, {"path": "shared.household.move_in", "value": "2027-06"}]})
    pid = client.get("/api/workspace").json()["proposals"][0]["id"]
    client.post(f"/api/proposals/{pid}/approve", json={"person": "B"})
    state = client.get("/api/decisions/buy-home?viewer=A").json()
    # Living together and the split are already agreed, so they are prefilled, not asked.
    for qid in ("move_before", "move_in", "rent", "split_mode"):
        assert qid not in state["pending"]
    q = {x["id"]: x for x in state["questions"]}
    assert q["move_before"]["value"] == "rent_first" and q["move_before"]["source"] == "plan"


def test_preferences_are_personal(client):
    r = client.post("/api/decisions/buy-home/step", json={"viewer": "A", "answers": {"priority": "speed"}})
    assert r.status_code == 422
    r = client.post("/api/decisions/buy-home/step", json={"viewer": "Z", "preferences": {"priority": "speed"}})
    assert r.status_code == 422


@pytest.mark.parametrize(("answers", "fragment"), [
    ({"price": 50}, "at least"),
    ({"purchase": "2026-05"}, "or later"),
    ({"purchase": "soon"}, "YYYY"),
    ({"deposit_pct": 0.1}, "at least"),
    ({"split_mode": "whatever"}, "options"),
    ({"bogus": 1}, "not a question"),
])
def test_invalid_answers_rejected(client, answers, fragment):
    r = client.post("/api/decisions/buy-home/step", json={"viewer": "A", "answers": answers})
    assert r.status_code == 422
    assert fragment.lower() in r.json()["detail"].lower().replace("2028-04", "yyyy")


def test_move_in_compiles_household_changes(client):
    s = step(client, "move-in", "B", answers={"move_in": "2027-09", "rent": 2900, "split_mode": "custom",
                                               "custom_share_first": 0.55})
    assert s["ready"]
    changes = {c["path"]: c["value"] for c in s["changes"]}
    assert changes == {"shared.household.move_in": "2027-09", "shared.household.rent": 2900,
                       "shared.split.mode": "custom", "shared.split.custom_share_first": 0.55,
                       "shared.household.enabled": True}
    sim = client.post("/api/simulate", json={"changes": s["changes"]}).json()
    assert sim["evaluation"]["household"]["joint_transfers"][8] > 0
    assert sim["evaluation"]["household"]["joint_transfers"][7] == 0


def test_have_child_compiles_child_and_extra_leave(client):
    s = step(client, "have-child", "A", answers={
        "birth": "2027-10", "birth_parent": "B", "childcare_days": 3, "childcare_start": 6,
        "extra_leave": "second", "extra_leave_months": 4, "extra_leave_income": 50, "cover_each_other": True,
        "split_mode": "income"})
    assert s["ready"], s["errors"]
    changes = {c["path"]: c["value"] for c in s["changes"]}
    (child,) = changes["shared.children"]
    assert child["birth"] == "2027-10" and child["leave"] == {"birth_parent": "B", "other_parent": "A"}
    assert child["childcare_days_per_week"] == 3 and child["childcare_start_months_after_birth"] == 6
    assert child["allowance_recipient"] == "B"  # suggested: the birth parent
    (brk,) = changes["people.B.career_breaks"]
    assert brk["start"] == "2028-02" and brk["months"] == 4 and brk["income_pct"] == 50
    assert changes["shared.split.adjust_for_breaks"] is True
    assert set(s["approvers"]) == {"A", "B"}
    # The horizon limit is stated honestly.
    assert any("covers only your child's first" in n for n in s["brief"]["limits"])
    ev = client.post("/api/simulate", json={"changes": s["changes"]}).json()["evaluation"]
    assert ev["children"][0]["birth"] == "2027-10" and ev["checks"]["ok"]

    # Switching to "no extra time" removes the career break again.
    s = step(client, "have-child", "A", answers={"extra_leave": "none"})
    assert "people.B.career_breaks" not in {c["path"] for c in s["changes"]}


def test_overlapping_extra_leave_is_reported(client):
    client.post("/api/proposals", json={"author": "B", "title": "Break", "changes": [{
        "path": "people.B.career_breaks",
        "value": [{"id": "cb1", "start": "2028-03", "months": 6, "income_pct": 0, "one_off_cost_chf": 0, "label": "Career break"}]}]})
    s = step(client, "have-child", "A", answers={
        "birth": "2027-10", "birth_parent": "B", "childcare_days": 2, "childcare_start": 4,
        "extra_leave": "second", "extra_leave_months": 6, "extra_leave_income": 0, "cover_each_other": False,
        "split_mode": "income"})
    assert not s["ready"] and "overlaps" in s["errors"][0]
    assert client.post("/api/decisions/have-child/propose", json={"author": "A"}).status_code == 422


def test_verified_alternative_is_absorbed_into_the_brief(client):
    s = step(client, "buy-home", "A", answers={"price": 1_000_000, "purchase": "2028-01", "target_date": "2028-06",
                                                "deposit_pct": 0.2, "ownership_share_first": 0.5,
                                                "move_before": "at_purchase", "split_mode": "equal"})
    s = step(client, "buy-home", "A", adjustments=[
        {"path": "shared.property.purchase", "value": "2028-09"},
        {"path": "people.B.categories.restaurants.budget_monthly", "value": 200}])
    q = {x["id"]: x for x in s["questions"]}
    assert q["purchase"]["value"] == "2028-09" and q["purchase"]["source"] == "answer"
    assert s["adjustments"] == [{"path": "people.B.categories.restaurants.budget_monthly", "value": 200, "note": None}]
    assert "people.B.categories.restaurants.budget_monthly" in {c["path"] for c in s["changes"]}


def test_offline_free_text_reads_the_focused_question(client):
    s = step(client, "buy-home", "A", text="Something around 1.2 million", focus="price")
    assert s["turn"]["mode"] == "offline"
    assert s["turn"]["extracted"][0]["question_id"] == "price"
    assert {x["id"]: x for x in s["questions"]}["price"]["value"] == 1_200_000
    s = step(client, "buy-home", "A", text="spring 2029", focus="purchase")
    assert {x["id"]: x for x in s["questions"]}["purchase"]["value"] == "2029-04"
    s = step(client, "buy-home", "A", text="no idea", focus="deposit_pct")
    assert s["turn"]["ambiguities"] and not s["turn"]["extracted"]


def test_reproposing_replaces_the_pending_version(client):
    step(client, "move-in", "A", answers={"move_in": "2027-05", "rent": 3000, "split_mode": "equal"})
    first = client.post("/api/decisions/move-in/propose", json={"author": "A"}).json()
    s = step(client, "move-in", "A", answers={"rent": 2800})
    assert s["proposal"]["outdated"] is True
    second = client.post("/api/decisions/move-in/propose", json={"author": "A"}).json()
    props = {p["id"]: p for p in client.get("/api/workspace").json()["proposals"]}
    assert props[first["id"]]["status"] == "superseded" and props[second["id"]]["status"] == "pending"


def test_remove_and_restart(client):
    step(client, "move-in", "A", answers={"move_in": "2027-05", "rent": 3000, "split_mode": "equal"})
    p = client.post("/api/decisions/move-in/propose", json={"author": "A"}).json()
    client.post(f"/api/proposals/{p['id']}/approve", json={"person": "B"})
    r = client.post("/api/decisions/move-in/propose", json={"author": "B", "remove": True}).json()
    assert r["changes"] == [{"path": "shared.household.enabled", "value": False, "note": None}]
    restarted = client.delete("/api/decisions/move-in?viewer=A").json()
    assert restarted["updated_at"] is None
    assert client.post("/api/decisions/have-child/propose", json={"author": "A", "remove": True}).status_code == 422


def test_reset_clears_interviews(client):
    step(client, "move-in", "A", answers={"rent": 3000})
    client.post("/api/reset")
    assert all(d["status"] == "not_started" for d in client.get("/api/decisions").json())


# ----------------------------------------------------------------------------- language model path


@pytest.fixture
def llm(monkeypatch, simple_plan, tmp_path):
    create = Mock()
    client = SimpleNamespace(messages=SimpleNamespace(create=create))
    import anthropic

    monkeypatch.setattr(anthropic, "Anthropic", Mock(return_value=client))
    monkeypatch.setattr(config, "LLM_PROVIDER", "anthropic")
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "fake-key")
    monkeypatch.setattr(config, "ANTHROPIC_MODEL", "claude-haiku-5-5")
    monkeypatch.setattr(api, "store", Store(path=str(tmp_path / "ws.json"), seed_factory=lambda: simple_plan))

    def reply(data):
        create.return_value = SimpleNamespace(stop_reason="end_turn",
                                              content=[SimpleNamespace(type="text", text=json.dumps(data))])
    return TestClient(api.app), create, reply


def test_llm_answers_are_validated(llm):
    client, create, reply = llm
    reply({"answers": [
        {"question_id": "price", "partner_id": None, "number": 1_100_000, "text": None, "flag": None},
        {"question_id": "purchase", "partner_id": None, "number": None, "text": "2029-03", "flag": None},
        {"question_id": "date_flex", "partner_id": "A", "number": None, "text": "months", "flag": None},
        {"question_id": "budget_flex", "partner_id": "B", "number": None, "text": "lower", "flag": None},
        {"question_id": "deposit_pct", "partner_id": None, "number": 0.05, "text": None, "flag": None},
        {"question_id": "salary", "partner_id": None, "number": 1, "text": None, "flag": None},
    ], "ambiguities": ["Is 2029 a firm date?"], "next_question_id": "target_date",
        "next_question": "Ana, what is the latest you'd still be happy to own by?"})
    s = step(client, "buy-home", "A", text="About 1.1M in March 2029, I could wait a few months. Ben would rather go cheaper.")
    t = s["turn"]
    assert t["mode"] == "llm"
    assert {e["question_id"] for e in t["extracted"]} == {"price", "purchase", "date_flex"}
    assert any("Only Ben" in r for r in t["rejected"])
    assert any("at least" in r for r in t["rejected"]) and any("salary" in r for r in t["rejected"])
    assert s["next"] == {"id": "target_date", "prompt": "Ana, what is the latest you'd still be happy to own by?", "source": "llm"}
    assert "B" not in s["questions"][next(i for i, q in enumerate(s["questions"]) if q["id"] == "budget_flex")]["answers"]
    # The model never sees results: no engine output is part of its context.
    sent = create.call_args.kwargs["messages"][0]["content"]
    assert "min_cash" not in sent and "affordability" not in sent


def test_llm_wording_with_invented_numbers_falls_back(llm):
    client, _, reply = llm
    reply({"answers": [], "ambiguities": [], "next_question_id": "price",
           "next_question": "Ana, you can afford CHF 1,734,000. What price?"})
    s = step(client, "buy-home", "A", ask_next=True)
    assert s["next"]["source"] == "deterministic"


def test_llm_failure_uses_guided_flow(llm):
    client, create, _ = llm
    create.side_effect = TimeoutError("slow")
    s = step(client, "buy-home", "A", text="1.3 million", focus="price")
    assert s["turn"]["mode"] == "offline" and "intake failed" in s["turn"]["notice"]
    assert {x["id"]: x for x in s["questions"]}["price"]["value"] == 1_300_000


def test_compiled_plan_is_valid_for_every_module(simple_plan):
    for m in D.MODULES.values():
        session = D.DecisionSession(module=m.id)
        changes, errors = D.compile_changes(m, simple_plan, session)
        assert not errors
        assert evaluate(apply_changes(simple_plan, changes))["checks"]["ok"]
