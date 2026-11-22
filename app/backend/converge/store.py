"""Workspace persistence and the mutual-approval workflow.

* The **current plan** is what both partners have agreed to.
* Any change is submitted as a **proposal**. It needs approval from every
  partner it affects: the owner for personal changes, both partners for
  shared changes or shared assumptions. The author's approval is implicit.
* When all approvals are in, the changes are re-applied to the *latest* plan
  (re-validated) and a new **version** is recorded. Old versions are kept for
  comparison; the original data-derived plan can always be restored.
"""
from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

from converge import config
from converge.engine.changes import ChangeError, apply_changes, describe, format_value, required_approvers
from converge.models import Change, Plan

ApprovalState = Literal["pending", "approved", "rejected"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Proposal(BaseModel):
    id: str
    author: str
    title: str
    note: str = ""
    kind: Literal["manual", "recommendation", "assistant", "restore"] = "manual"
    changes: list[Change]
    described: list[dict] = []
    approvals: dict[str, ApprovalState]
    status: Literal["pending", "applied", "rejected", "superseded"] = "pending"
    created_at: str = Field(default_factory=_now)
    decided_at: str | None = None
    error: str | None = None
    version_id: int | None = None


class Version(BaseModel):
    id: int
    title: str
    author: str | None
    created_at: str = Field(default_factory=_now)
    proposal_id: str | None = None
    plan: Plan


class Workspace(BaseModel):
    plan: Plan
    versions: list[Version]
    proposals: list[Proposal] = []


class WorkflowError(ValueError):
    pass


def _describe_all(plan: Plan, changes: list[Change]) -> list[dict]:
    out = []
    for ch in changes:
        d = describe(plan, ch)
        out.append(dict(**d.model_dump(), previous_text=format_value(d.unit, d.previous), value_text=format_value(d.unit, d.value)))
    return out


def normalise(changes: list[Change]) -> list[Change]:
    """Later changes to the same path win; order of first appearance is kept."""
    last: dict[str, Change] = {}
    order: list[str] = []
    for ch in changes:
        if ch.path not in last:
            order.append(ch.path)
        last[ch.path] = ch
    return [last[p] for p in order]


class Store:
    def __init__(self, path=None, seed_factory=None):
        self.path = path or (config.STATE_DIR / "workspace.json")
        self._lock = threading.RLock()
        self._seed_factory = seed_factory
        self._ws: Workspace | None = None

    # ------------------------------------------------------------------ io
    def _seed(self) -> Workspace:
        if self._seed_factory is None:
            from converge.seed import default_plan

            plan = default_plan()
        else:
            plan = self._seed_factory()
        return Workspace(plan=plan, versions=[Version(id=0, title="Starting point from UBS data", author=None, plan=plan)])

    def load(self) -> Workspace:
        with self._lock:
            if self._ws is not None:
                return self._ws
            if self.path and os.path.exists(self.path):
                try:
                    self._ws = Workspace.model_validate_json(open(self.path).read())
                    return self._ws
                except Exception:  # corrupted/old state -> reseed
                    pass
            self._ws = self._seed()
            self._save()
            return self._ws

    def _save(self) -> None:
        if not self.path or self._ws is None:
            return
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = f"{self.path}.tmp"
        with open(tmp, "w") as fh:
            fh.write(self._ws.model_dump_json())
        os.replace(tmp, self.path)

    # ------------------------------------------------------------------ queries
    @property
    def plan(self) -> Plan:
        return self.load().plan

    @property
    def original(self) -> Plan:
        return self.load().versions[0].plan

    def proposal(self, pid: str) -> Proposal:
        for p in self.load().proposals:
            if p.id == pid:
                return p
        raise WorkflowError("proposal not found")

    def version(self, vid: int) -> Version:
        for v in self.load().versions:
            if v.id == vid:
                return v
        raise WorkflowError("version not found")

    # ------------------------------------------------------------------ commands
    def propose(self, author: str, title: str, changes: list[Change], kind: str = "manual", note: str = "") -> Proposal:
        with self._lock:
            ws = self.load()
            if author not in [p.id for p in ws.plan.people]:
                raise WorkflowError("unknown author")
            changes = normalise(changes)
            if not changes:
                raise WorkflowError("a proposal needs at least one change")
            apply_changes(ws.plan, changes)  # validates; raises ChangeError
            approvers = required_approvers(ws.plan, changes)
            prop = Proposal(
                id=uuid.uuid4().hex[:10],
                author=author,
                title=title.strip() or "Plan update",
                note=note,
                kind=kind,  # type: ignore[arg-type]
                changes=changes,
                described=_describe_all(ws.plan, changes),
                approvals={pid: ("approved" if pid == author else "pending") for pid in approvers},
            )
            ws.proposals.insert(0, prop)
            self._maybe_apply(prop)
            self._save()
            return prop

    def approve(self, proposal_id: str, person: str) -> Proposal:
        with self._lock:
            prop = self.proposal(proposal_id)
            self._check_decider(prop, person)
            prop.approvals[person] = "approved"
            self._maybe_apply(prop)
            self._save()
            return prop

    def reject(self, proposal_id: str, person: str) -> Proposal:
        with self._lock:
            prop = self.proposal(proposal_id)
            if prop.status != "pending":
                raise WorkflowError("proposal is no longer pending")
            if person not in prop.approvals and person != prop.author:
                raise WorkflowError("this partner is not asked to decide on this proposal")
            if person in prop.approvals:
                prop.approvals[person] = "rejected"
            prop.status = "rejected"
            prop.decided_at = _now()
            self._save()
            return prop

    def reset(self) -> Workspace:
        with self._lock:
            self._ws = self._seed()
            self._save()
            return self._ws

    def restore(self, version_id: int, author: str) -> Proposal:
        """Propose returning to an earlier version (needs both partners)."""
        with self._lock:
            target = self.version(version_id).plan
            changes = diff_plans(self.plan, target)
            if not changes:
                raise WorkflowError("the current plan already matches this version")
            ws = self.load()
            prop = Proposal(
                id=uuid.uuid4().hex[:10],
                author=author,
                title=f"Return to: {self.version(version_id).title}",
                kind="restore",
                changes=changes,
                described=_describe_all(ws.plan, changes),
                approvals={p.id: ("approved" if p.id == author else "pending") for p in ws.plan.people},
            )
            ws.proposals.insert(0, prop)
            self._maybe_apply(prop)
            self._save()
            return prop

    # ------------------------------------------------------------------ internals
    def _check_decider(self, prop: Proposal, person: str) -> None:
        if prop.status != "pending":
            raise WorkflowError("proposal is no longer pending")
        if person not in prop.approvals:
            raise WorkflowError("this partner is not asked to approve this proposal")
        if prop.approvals[person] != "pending":
            raise WorkflowError("already decided")

    def _maybe_apply(self, prop: Proposal) -> None:
        if prop.status != "pending" or not all(v == "approved" for v in prop.approvals.values()):
            return
        ws = self.load()
        try:
            new_plan = apply_changes(ws.plan, prop.changes)
        except ChangeError as e:
            prop.status = "superseded"
            prop.error = str(e)
            prop.decided_at = _now()
            return
        vid = max(v.id for v in ws.versions) + 1
        ws.versions.append(Version(id=vid, title=prop.title, author=prop.author, proposal_id=prop.id, plan=new_plan))
        ws.plan = new_plan
        prop.status = "applied"
        prop.version_id = vid
        prop.decided_at = _now()


def diff_plans(a: Plan, b: Plan) -> list[Change]:
    """Changes (on whitelisted levers) that turn plan ``a`` into plan ``b``."""
    from converge.engine.changes import LEVERS, find_lever, get_value

    da, db = a.model_dump(), b.model_dump()
    paths: list[str] = []
    for lv in LEVERS:
        pat = lv.pattern
        if "{pid}" in pat:
            for p in b.people:
                base = pat.replace("{pid}", p.id)
                if "{key}" in base:
                    paths += [base.replace("{key}", c.key) for c in p.categories]
                elif "{gid}" in base:
                    paths += [base.replace("{gid}", g.id) for g in p.goals]
                elif "{bid}" in base:
                    continue  # covered by whole-list career_breaks lever
                else:
                    paths.append(base)
        else:
            paths.append(pat)
    out = []
    for path in paths:
        try:
            find_lever(path)
            va, vb = get_value(da, path), get_value(db, path)
        except ChangeError:
            continue
        if json.dumps(va, sort_keys=True, default=str) != json.dumps(vb, sort_keys=True, default=str):
            out.append(Change(path=path, value=vb))
    return out
