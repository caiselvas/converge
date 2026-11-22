"""HTTP API (FastAPI). All financial numbers returned are computed by the engine."""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from converge import ai, assumptions, config
from converge.data import profiles as profile_data
from converge.data.ubs import DataUnavailableError
from converge.engine import months as M
from converge.engine.changes import ChangeError, apply_changes, describe, format_value, lever_catalogue, required_approvers
from converge.engine.evaluate import evaluate
from converge.engine.recommend import recommend
from converge.engine.what_if import GRADUATE_SURVEY, PROGRAMS, WhatIf, compare
from converge.models import KITA_INFANT_TARIFF, Change, Child, ParentalLeave, Plan
from converge.store import Store, WorkflowError, normalise
from converge.voice.realtime import router_for as voice_router
from converge.voice.routes import router_for as twin_router

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Converge API", version="0.1.0",
              description="Deterministic financial twins for couples. Not financial advice.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

store = Store()
app.include_router(twin_router(lambda: store.plan))
app.include_router(voice_router(lambda: store.plan))


class StressIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mortgage_rate: float | None = None
    expense_inflation: float | None = None
    investment_return: float | None = None


class ChangesIn(BaseModel):
    changes: list[Change] = Field(default_factory=list, max_length=200)
    base: Literal["current", "original"] = "current"
    include_base: bool = True
    stress: StressIn | None = None


class WhatIfIn(WhatIf):
    draft: list[Change] = Field(default_factory=list, max_length=200)


class ProposalIn(BaseModel):
    author: str
    title: str = Field("", max_length=200)
    note: str = Field("", max_length=1000)
    kind: Literal["manual", "recommendation", "assistant"] = "manual"
    changes: list[Change] = Field(min_length=1, max_length=200)


class DecisionIn(BaseModel):
    person: str


class RestoreIn(BaseModel):
    author: str


class InterpretIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    viewer: str
    changes: list[Change] = Field(default_factory=list, max_length=200)


class ExplainIn(BaseModel):
    changes: list[Change] = Field(default_factory=list, max_length=200)
    with_recommendations: bool = False
    stress: StressIn | None = None


def _base(which: str = "current") -> Plan:
    return store.original if which == "original" else store.plan


def _apply(plan: Plan, changes: list[Change]) -> Plan:
    try:
        return apply_changes(plan, normalise(changes))
    except ChangeError as e:
        raise HTTPException(422, str(e)) from None


def _with_stress(plan: Plan, stress: StressIn | None) -> Plan:
    if stress is None:
        return plan
    paths = {
        "mortgage_rate": "shared.property.mortgage_rate",
        "expense_inflation": "assumptions.expense_inflation",
        "investment_return": "assumptions.investment_return",
    }
    return _apply(plan, [Change(path=paths[key], value=value) for key, value in
                         stress.model_dump(exclude_none=True).items()])


def _described(plan: Plan, changes: list[Change]) -> list[dict]:
    out = []
    for ch in normalise(changes):
        d = describe(plan, ch)
        out.append(dict(**d.model_dump(), previous_text=format_value(d.unit, d.previous), value_text=format_value(d.unit, d.value)))
    return out


@app.exception_handler(DataUnavailableError)
async def _data_err(_, exc: DataUnavailableError):
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.get("/api/health")
def health():
    provider = config.llm_provider()
    available = ai.llm_available()
    return dict(ok=True, llm_available=available, llm_model=ai.llm_model(provider) if provider and available else None)


@app.get("/api/workspace")
def workspace():
    ws = store.load()
    first, second = ws.plan.people
    child = Child(
        id="child-1", label="Child 1", birth=M.add(ws.plan.assumptions.start, 12),
        allowance_recipient=first.id, leave=ParentalLeave(birth_parent=first.id, other_parent=second.id),
    )
    return dict(
        plan=ws.plan.model_dump(),
        people=[dict(id=p.id, name=p.name) for p in ws.plan.people],
        versions=[dict(id=v.id, title=v.title, author=v.author, created_at=v.created_at, proposal_id=v.proposal_id)
                  for v in ws.versions],
        proposals=[p.model_dump() for p in ws.proposals],
        llm_available=ai.llm_available(),
        child_defaults=dict(child=child.model_dump(), first_day_tariff=KITA_INFANT_TARIFF),
    )


@app.post("/api/simulate")
def simulate_endpoint(body: ChangesIn):
    base = _base(body.base)
    plan = _apply(base, body.changes)
    ev = evaluate(_with_stress(plan, body.stress))
    out = dict(
        evaluation=ev,
        plan=plan.model_dump(),
        changes=_described(base, body.changes),
        approvers=required_approvers(base, normalise(body.changes)) if body.changes else [],
    )
    if body.include_base:
        out["base"] = evaluate(base)
    return out


@app.post("/api/recommendations")
def recommendations(body: ChangesIn):
    plan = _apply(_base(body.base), body.changes)
    return recommend(_with_stress(plan, body.stress))


@app.get("/api/what-if")
def what_if_catalogue():
    return {"programs": PROGRAMS, "graduate_survey": GRADUATE_SURVEY}


@app.post("/api/what-if")
def what_if(body: WhatIfIn):
    try:
        return compare(_apply(store.plan, body.draft), body)
    except KeyError:
        raise HTTPException(422, "Choose a person in this workspace.") from None
    except ValueError as error:
        raise HTTPException(422, str(error)) from None


@app.post("/api/proposals")
def create_proposal(body: ProposalIn):
    try:
        prop = store.propose(body.author, body.title, body.changes, body.kind, body.note)
    except (ChangeError, WorkflowError) as e:
        raise HTTPException(422, str(e)) from None
    return prop.model_dump()


@app.post("/api/proposals/{pid}/approve")
def approve(pid: str, body: DecisionIn):
    try:
        return store.approve(pid, body.person).model_dump()
    except WorkflowError as e:
        raise HTTPException(409, str(e)) from None


@app.post("/api/proposals/{pid}/reject")
def reject(pid: str, body: DecisionIn):
    try:
        return store.reject(pid, body.person).model_dump()
    except WorkflowError as e:
        raise HTTPException(409, str(e)) from None


@app.get("/api/proposals/{pid}/preview")
def preview(pid: str):
    """Impact of a pending proposal on the current plan."""
    try:
        prop = store.proposal(pid)
    except WorkflowError as e:
        raise HTTPException(404, str(e)) from None
    base = store.plan
    plan = _apply(base, prop.changes)
    return dict(base=evaluate(base), evaluation=evaluate(plan), changes=_described(base, prop.changes))


@app.get("/api/versions/{vid}")
def version(vid: int):
    try:
        v = store.version(vid)
    except WorkflowError as e:
        raise HTTPException(404, str(e)) from None
    return dict(id=v.id, title=v.title, plan=v.plan.model_dump(), evaluation=evaluate(v.plan))


@app.post("/api/versions/{vid}/restore")
def restore(vid: int, body: RestoreIn):
    try:
        return store.restore(vid, body.author).model_dump()
    except (WorkflowError, ChangeError) as e:
        raise HTTPException(409, str(e)) from None


@app.post("/api/reset")
def reset():
    store.reset()
    return workspace()


@app.get("/api/assumptions")
def assumption_registry():
    return assumptions.registry(store.plan)


@app.get("/api/levers")
def levers():
    return lever_catalogue(store.plan)


@app.get("/api/provenance/{profile_id}")
def provenance(profile_id: str):
    if profile_id not in [p.id for p in store.plan.people]:
        raise HTTPException(404, "profile is not part of this workspace")
    data = profile_data.provenance(profile_id)
    return jsonable(data)


@app.post("/api/assistant/interpret")
def interpret(body: InterpretIn):
    base = _apply(store.plan, body.changes)
    if body.viewer not in [p.id for p in base.people]:
        raise HTTPException(422, "unknown viewer")
    try:
        return ai.interpret(base, body.text, body.viewer)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


@app.post("/api/assistant/explain")
def explain(body: ExplainIn):
    plan = _with_stress(_apply(store.plan, body.changes), body.stress)
    ev = evaluate(plan)
    recs = recommend(plan)["recommendations"] if body.with_recommendations else None
    return ai.explain(ev, recs)


def jsonable(obj):
    import math

    if isinstance(obj, dict):
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    if hasattr(obj, "item"):
        obj = obj.item()
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    return obj
