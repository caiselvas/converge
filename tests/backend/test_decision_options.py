"""Decision workspace: immediate comparison, user options, engine alternatives and labels."""
import pytest
from fastapi.testclient import TestClient

from converge import api, config
from converge import decisions as D
from converge.engine.changes import apply_changes
from converge.engine.evaluate import evaluate
from converge.models import Change
from converge.store import Store


@pytest.fixture
def client(simple_plan, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(config, "OPENAI_API_KEY", "")
    monkeypatch.setattr(config, "STATE_DIR", tmp_path)
    monkeypatch.setattr(api, "store", Store(path=str(tmp_path / "ws.json"), seed_factory=lambda: simple_plan))
    return TestClient(api.app)


def compare(client, mid, **body):
    r = client.post(f"/api/decisions/{mid}/compare", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_a_viable_plan_still_gets_meaningful_alternatives(client):
    before = client.get("/api/workspace").json()["plan"]
    result = compare(client, "move-in")
    yours, *alternatives = result["columns"]
    assert yours["id"] == "your-plan" and yours["safe"]
    assert alternatives, "a safe plan must still be compared with alternatives"
    assert all(col["safe"] and col["kind"] == "variant" for col in alternatives)
    assert len({(round(c["end_net_worth"]), c["event"]) for c in result["columns"]}) == len(result["columns"])
    assert all(col["tradeoff"] for col in alternatives)
    # Every series comes from the engine and spans the full horizon.
    assert all(len(col["net_worth"]) == len(result["months"]) for col in result["columns"])
    assert client.get("/api/workspace").json()["plan"] == before


def test_labels_are_only_given_to_safe_options(client, simple_plan):
    result = compare(client, "buy-home")
    for col in result["columns"]:
        if not col["safe"]:
            assert col["labels"] == []
    ids = [label["id"] for col in result["columns"] for label in col["labels"]]
    assert len(ids) == len(set(ids)), "each criterion has at most one winner"
    assert "preferences" not in ids  # nobody has stated preferences yet


def test_preference_label_needs_both_partners(client):
    client.post("/api/decisions/buy-home/step", json={"viewer": "A", "preferences": {"budget_flex": "lower"}})
    assert "preferences" not in [l["id"] for c in compare(client, "buy-home")["columns"] for l in c["labels"]]
    client.post("/api/decisions/buy-home/step", json={"viewer": "B", "preferences": {"budget_flex": "lower"}})
    labels = {l["id"]: c for c in compare(client, "buy-home")["columns"] for l in c["labels"]}
    if "preferences" in labels:
        assert labels["preferences"]["safe"]


def test_user_options_are_independent_and_compared(client):
    r = client.put("/api/decisions/buy-home/options", json={"viewer": "A", "options": [
        {"id": "opt-1", "label": "Bigger home", "answers": {"price": 1_100_000}},
        {"id": "opt-2", "label": "Later", "answers": {"purchase": "2028-09"}},
    ]})
    assert r.status_code == 200, r.text
    state = r.json()
    assert [o["id"] for o in state["options"]] == ["opt-1", "opt-2"]
    cols = {c["id"]: c for c in compare(client, "buy-home")["columns"]}
    assert {"your-plan", "opt-1", "opt-2"} <= set(cols)
    big = {c["path"]: c["value"] for c in cols["opt-1"]["changes"]}
    later = {c["path"]: c["value"] for c in cols["opt-2"]["changes"]}
    assert big["shared.property.price"] == 1_100_000 and "shared.property.purchase" not in big
    assert later["shared.property.purchase"] == "2028-09" and "shared.property.price" not in later
    # Options never touch the agreed plan.
    assert client.get("/api/workspace").json()["plan"]["shared"]["property"]["enabled"] is False


def test_user_options_are_validated(client):
    too_many = [{"id": f"opt-{i}", "answers": {}} for i in range(1, 5)]
    assert client.put("/api/decisions/buy-home/options", json={"viewer": "A", "options": too_many}).status_code == 422
    personal = [{"id": "opt-1", "answers": {"priority": "speed"}}]
    assert client.put("/api/decisions/buy-home/options", json={"viewer": "A", "options": personal}).status_code == 422
    bad = [{"id": "opt-1", "answers": {"price": 5}}]
    assert client.put("/api/decisions/buy-home/options", json={"viewer": "A", "options": bad}).status_code == 422


def test_choosing_a_user_option_proposes_its_values(client):
    client.put("/api/decisions/move-in/options", json={"viewer": "A", "options": [
        {"id": "opt-1", "label": "Cheaper flat", "answers": {"rent": 2100}}]})
    col = next(c for c in compare(client, "move-in")["columns"] if c["id"] == "opt-1")
    assert col["safe"] and col["kind"] == "option"
    p = client.post("/api/decisions/move-in/propose", json={"author": "A", "option_id": "opt-1"})
    assert p.status_code == 200, p.text
    changes = {c["path"]: c["value"] for c in p.json()["changes"]}
    assert changes["shared.household.rent"] == 2100
    state = client.get("/api/decisions/move-in?viewer=A").json()
    assert next(q for q in state["questions"] if q["id"] == "rent")["value"] == 2100
    assert state["options"] == [] and state["proposal"]["outdated"] is False


def test_stress_never_reaches_a_proposal(client):
    p = client.post("/api/decisions/move-in/propose",
                    json={"author": "A", "option_id": "your-plan", "stress": {"income_drop": 0.05, "expense_inflation": 0.03}})
    assert p.status_code == 200, p.text
    paths = [c["path"] for c in p.json()["changes"]]
    assert not any(path.startswith("assumptions.") or path.endswith("income_monthly") for path in paths)


def test_uncertainty_is_on_request_and_matched(client):
    r = client.post("/api/decisions/move-in/uncertainty", json={"option_id": "your-plan"})
    assert r.status_code == 200, r.text
    risk = r.json()
    assert risk["trials"] > 0 and len(risk["paired_worth_delta"]) == 3
    assert len(risk["baseline_breaches"]) == len(risk["scenario_breaches"]) == 3


def test_study_mode_uses_published_programme(client):
    s = client.post("/api/decisions/career-break/step", json={"viewer": "B", "answers": {
        "person": "B", "study_program": "quant_finance", "start": "2027-09", "income_kept": 0.3}}).json()
    entry = next(c for c in s["changes"] if c["path"] == "people.B.career_breaks")["value"][0]
    assert entry["study_program"] == "quant_finance" and entry["months"] == 18
    assert entry["semester_fee_chf"] == 780 and entry["post_study_pay_delta_chf"] == 0
    assert any("does not guarantee" in note for note in s["brief"]["limits"])


def test_memory_hints_are_personal_and_confirmed_only(client, tmp_path):
    from converge.voice.memory import Item
    from converge.voice.routes import memory_db

    db = memory_db()
    session = db.start("A")
    evidence = db.add_turn(session, "user", "I would delay the home rather than lower the budget")
    saved = db.save(session, evidence, [Item(dimension="risk_flexibility", key="home.flexibility", value="delay",
                                             kind="fact", confidence=1.0, quote="I would delay the home", why=None)])
    hints = client.get("/api/decisions/buy-home/memory?viewer=A").json()["hints"]
    assert hints and hints[0]["suggestion"] is None  # still unconfirmed
    db.resolve("A", saved[0]["id"], "confirmed")
    hint = client.get("/api/decisions/buy-home/memory?viewer=A").json()["hints"][0]
    assert hint["suggestion"]["question_id"] == "date_flex" and hint["suggestion"]["personal"]
    assert client.get("/api/decisions/buy-home/memory?viewer=B").json()["hints"] == []
    # A hint is never applied by itself.
    assert client.get("/api/decisions/buy-home?viewer=A").json()["brief"]["partners"][0]["preferences"][1]["value"] is None


def test_every_variant_compiles(simple_plan):
    for m in D.MODULES.values():
        session = D.DecisionSession(module=m.id)
        values, _ = D.resolve(m, simple_plan, session)
        for v in m.variants(simple_plan, values):
            try:
                overrides = {k: D.coerce(m.question(k), x, simple_plan) for k, x in v.overrides.items()}
            except D.AnswerError:
                continue
            _, changes, errors = D.option_plan(m, simple_plan, session, overrides)
            if not errors:
                assert evaluate(apply_changes(simple_plan, changes))["checks"]["ok"]
