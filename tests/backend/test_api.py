"""API request validation and the end-to-end flow."""
import pytest
from fastapi.testclient import TestClient

from converge import api
from converge.store import Store


@pytest.fixture
def client(simple_plan, tmp_path, monkeypatch):
    monkeypatch.setattr(api, "store", Store(path=str(tmp_path / "ws.json"), seed_factory=lambda: simple_plan))
    return TestClient(api.app)


def test_workspace_and_simulate(client):
    ws = client.get("/api/workspace").json()
    assert [p["name"] for p in ws["people"]] == ["Ana", "Ben"]
    r = client.post("/api/simulate", json={"changes": [{"path": "shared.property.enabled", "value": True}]})
    assert r.status_code == 200
    body = r.json()
    assert body["evaluation"]["status"] == "conflict" and body["base"]["status"] == "on_track"
    assert body["approvers"] == ["A", "B"]
    assert body["evaluation"]["checks"]["ok"] is True
    assert len(body["evaluation"]["months"]) == 36


@pytest.mark.parametrize("change", [
    {"path": "people.A.secret", "value": 1},
    {"path": "shared.property.purchase", "value": "June"},
    {"path": "shared.property.price", "value": -5},
    {"path": "people.Z.income_monthly", "value": 10},
    {"path": "assumptions.horizon_months", "value": 5000},
])
def test_invalid_changes_return_422(client, change):
    r = client.post("/api/simulate", json={"changes": [change]})
    assert r.status_code == 422


def test_malformed_body_422(client):
    assert client.post("/api/simulate", json={"changes": "nope"}).status_code == 422
    assert client.post("/api/proposals", json={"author": "A", "changes": []}).status_code == 422


def test_proposal_flow(client):
    p = client.post("/api/proposals", json={"author": "A", "title": "Home",
                                            "changes": [{"path": "shared.property.enabled", "value": True}]}).json()
    assert p["status"] == "pending"
    prev = client.get(f"/api/proposals/{p['id']}/preview").json()
    assert prev["evaluation"]["status"] == "conflict"
    assert client.post(f"/api/proposals/{p['id']}/approve", json={"person": "A"}).status_code == 409
    done = client.post(f"/api/proposals/{p['id']}/approve", json={"person": "B"}).json()
    assert done["status"] == "applied"
    assert client.get("/api/workspace").json()["plan"]["shared"]["property"]["enabled"] is True
    recs = client.post("/api/recommendations", json={"changes": []}).json()
    assert recs["recommendations"]


def test_assistant_offline(client):
    r = client.post("/api/assistant/interpret", json={"text": "Ben takes 4 months off from Mar 2027", "viewer": "A"})
    body = r.json()
    assert body["mode"] in ("offline", "llm")
    if body["mode"] == "offline":
        assert body["changes"][0]["path"] == "people.B.career_breaks"
        assert body["changes"][0]["value"][0]["months"] == 4
        assert body["changes"][0]["value"][0]["start"] == "2027-03"
    assert client.post("/api/assistant/interpret", json={"text": "x", "viewer": "nobody"}).status_code == 422


def test_stress_overlay_changes_projection_without_entering_plan_or_draft(client):
    changes = [{"path": "shared.property.enabled", "value": True}]
    base = client.post("/api/simulate", json={"changes": changes}).json()
    stress = {"mortgage_rate": 0.04}
    result = client.post("/api/simulate", json={"changes": changes, "stress": stress})
    assert result.status_code == 200
    projected = result.json()
    assert projected["evaluation"]["property"]["monthly_interest"] != base["evaluation"]["property"]["monthly_interest"]
    assert projected["base"] == base["base"]
    assert projected["plan"] == base["plan"]
    assert projected["changes"] == base["changes"]
    assert projected["approvers"] == base["approvers"]
    assert client.get("/api/workspace").json()["plan"]["shared"]["property"]["enabled"] is False
    recs = client.post("/api/recommendations", json={"changes": changes, "stress": stress})
    assert recs.status_code == 200
    assert all(c["path"] != "shared.property.mortgage_rate" for r in recs.json()["recommendations"] for c in r["raw_changes"])


@pytest.mark.parametrize("stress", [{"mortgage_rate": -1}, {"tax_rate": 0.3}])
def test_invalid_stress_overlay_returns_422(client, stress):
    assert client.post("/api/simulate", json={"stress": stress}).status_code == 422
    assert client.post("/api/recommendations", json={"stress": stress}).status_code == 422


def test_child_changes_require_both_partners(client):
    defaults = client.get("/api/workspace").json()["child_defaults"]["child"]
    changes = [{"path": "shared.children", "value": [defaults]}]
    result = client.post("/api/simulate", json={"changes": changes})
    assert result.status_code == 200
    assert result.json()["approvers"] == ["A", "B"]
    assert result.json()["evaluation"]["children"][0]["birth"] == defaults["birth"]
    proposal = client.post("/api/proposals", json={"author": "A", "title": "Child plan", "changes": changes}).json()
    assert proposal["status"] == "pending"
    assert client.get("/api/workspace").json()["plan"]["shared"]["children"] == []
    approved = client.post(f"/api/proposals/{proposal['id']}/approve", json={"person": "B"})
    assert approved.status_code == 200
    assert client.get("/api/workspace").json()["plan"]["shared"]["children"] == [defaults]


@pytest.mark.parametrize("invalid", [
    {"birth": "2028-13"},
    {"childcare_days_per_week": 6},
    {"childcare_day_tariff": -10},
    {"allowance_recipient": "unknown"},
    {"leave": {"birth_parent": "A", "other_parent": "A"}},
])
def test_invalid_child_levers_return_422(client, invalid):
    defaults = client.get("/api/workspace").json()["child_defaults"]["child"]
    change = {"path": "shared.children", "value": [{**defaults, **invalid}]}
    assert client.post("/api/simulate", json={"changes": [change]}).status_code == 422


def test_child_limit_and_unique_ids(client):
    defaults = client.get("/api/workspace").json()["child_defaults"]["child"]
    for children in ([defaults, defaults], [{**defaults, "id": f"child-{i}"} for i in range(4)]):
        change = {"path": "shared.children", "value": children}
        assert client.post("/api/simulate", json={"changes": [change]}).status_code == 422
