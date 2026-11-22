"""Mutual approval workflow and versioning."""
import pytest

from converge.engine.changes import ChangeError
from converge.models import Change
from converge.store import Store, WorkflowError


@pytest.fixture
def store(simple_plan, tmp_path):
    return Store(path=str(tmp_path / "ws.json"), seed_factory=lambda: simple_plan)


def test_shared_change_needs_both_partners(store):
    p = store.propose("A", "Buy a home", [Change(path="shared.property.enabled", value=True)])
    assert p.status == "pending" and p.approvals == {"A": "approved", "B": "pending"}
    assert not store.plan.shared.property.enabled
    with pytest.raises(WorkflowError):
        store.approve(p.id, "A")  # already decided
    p = store.approve(p.id, "B")
    assert p.status == "applied" and store.plan.shared.property.enabled
    assert [v.id for v in store.load().versions] == [0, 1]


def test_personal_change_by_owner_applies_immediately(store):
    p = store.propose("B", "Less restaurants", [Change(path="people.B.categories.restaurants.budget_monthly", value=200)])
    assert p.status == "applied"
    assert next(c for c in store.plan.person("B").categories if c.key == "restaurants").budget_monthly == 200


def test_change_to_partners_personal_plan_needs_their_approval(store):
    p = store.propose("A", "Suggest", [Change(path="people.B.categories.leisure.budget_monthly", value=100)])
    assert p.approvals == {"B": "pending"} and p.status == "pending"
    store.reject(p.id, "B")
    assert store.proposal(p.id).status == "rejected"
    assert next(c for c in store.plan.person("B").categories if c.key == "leisure").budget_monthly == 200


def test_invalid_changes_rejected(store):
    with pytest.raises(ChangeError):
        store.propose("A", "x", [Change(path="people.B.opening_cash", value=1e9)])  # not a lever
    with pytest.raises(ChangeError):
        store.propose("A", "x", [Change(path="shared.property.purchase", value="2028-13")])
    with pytest.raises(ChangeError):
        store.propose("A", "x", [Change(path="shared.property.deposit_pct", value=0.1)])  # below 20%
    with pytest.raises(WorkflowError):
        store.propose("Z", "x", [Change(path="shared.property.enabled", value=True)])


def test_restore_original_needs_both(store):
    p = store.propose("A", "Home", [Change(path="shared.property.enabled", value=True)])
    store.approve(p.id, "B")
    r = store.restore(0, "B")
    assert r.kind == "restore" and r.status == "pending"
    store.approve(r.id, "A")
    assert not store.plan.shared.property.enabled


def test_persistence(store, simple_plan, tmp_path):
    p = store.propose("A", "Home", [Change(path="shared.property.enabled", value=True)])
    again = Store(path=store.path, seed_factory=lambda: simple_plan)
    assert again.proposal(p.id).status == "pending"
