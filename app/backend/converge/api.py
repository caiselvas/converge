"""HTTP API (FastAPI). All financial numbers returned are computed by the engine."""
from __future__ import annotations

import json
import logging
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from converge import ai, assumptions, config
from converge import decisions as D
from converge.data import profiles as profile_data
from converge.data.ubs import DataUnavailableError
from converge.engine import months as M
from converge.engine.changes import ChangeError, apply_changes, describe, format_value, lever_catalogue, required_approvers
from converge.engine.comparison import compare, with_stress
from converge.engine.evaluate import evaluate
from converge.engine.recommend import recommend
from converge.engine.what_if import GRADUATE_SURVEY, PROGRAMS, WhatIf, compare as what_if_compare
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


def _decision_facts(mid: str) -> dict | None:
    """Compact engine facts about the decision on screen, for the finance assistant."""
    if mid not in D.MODULES:
        return None
    m = D.MODULES[mid]
    try:
        result = _comparison(m, store.plan, store.decision_session(mid), None)
    except HTTPException:
        return None
    return dict(decision=m.title, horizon_end=result["end_month"], provenance="simulated", options=[
        dict(id=c["id"], title=c["title"], inputs=c["summary"], safe=c["safe"], issue=c["issue"],
             household_net_worth_at_end=round(c["end_net_worth"]), labels=[label["text"] for label in c["labels"]],
             tradeoff_vs_your_plan=c["tradeoff"],
             people=[dict(name=p["name"], lowest_cash=round(p["min_cash"]), lowest_cash_month=p["min_cash_month"],
                          safety_buffer=round(p["floor"]), headroom=round(p["headroom"])) for p in c["people"]])
        for c in result["columns"]
    ])


app.include_router(twin_router(lambda: store.plan, decision_context=lambda mid: _decision_facts(mid)))
app.include_router(voice_router(lambda: store.plan))


class StressIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mortgage_rate: float | None = None
    expense_inflation: float | None = None
    investment_return: float | None = None
    income_drop: float | None = Field(None, ge=0, le=0.50)


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


class DecisionStepIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    viewer: str
    answers: dict[str, Any] = Field(default_factory=dict)
    preferences: dict[str, Any] = Field(default_factory=dict)
    adjustments: list[Change] | None = Field(None, max_length=50)
    text: str | None = Field(None, max_length=1000)
    focus: str | None = None
    ask_next: bool = False


class CompareIn(BaseModel):
    stress: StressIn | None = None


class OptionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str = Field("", max_length=60)
    answers: dict[str, Any] = Field(default_factory=dict)


class OptionsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    viewer: str
    options: list[OptionIn] = Field(default_factory=list, max_length=D.MAX_USER_OPTIONS)


class UncertaintyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    option_id: str
    stress: StressIn | None = None


class DecisionProposeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    author: str
    title: str = Field("", max_length=200)
    remove: bool = False
    option_id: str | None = None
    stress: StressIn | None = None


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
    try:
        return with_stress(plan, stress.model_dump(exclude_none=True))
    except ChangeError as e:
        raise HTTPException(422, str(e)) from None


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
        decisions=[_decision_summary(m) for m in D.MODULES.values()],
    )


# --------------------------------------------------------------------------- life decisions


def _decision_module(mid: str) -> D.DecisionModule:
    try:
        return D.module(mid)
    except D.AnswerError as e:
        raise HTTPException(404, str(e)) from None


def _linked_proposal(session: D.DecisionSession) -> dict | None:
    if not session.proposal_id:
        return None
    try:
        p = store.proposal(session.proposal_id)
    except WorkflowError:
        return None
    return dict(id=p.id, status=p.status, approvals=p.approvals, author=p.author, title=p.title,
                changes=[c.model_dump() for c in p.changes])


def _decision_summary(m: D.DecisionModule) -> dict:
    session = store.decision_session(m.id) if store.has_decision_session(m.id) else None
    return D.summary(m, store.plan, session, _linked_proposal(session) if session else None)


def _changes_differ(plan: Plan, proposed: list[dict], current: list[dict]) -> bool:
    """Compare two change sets by the values they produce, so equivalent encodings
    (for example a list entry with or without defaulted fields) count as equal."""
    if {c["path"] for c in proposed} != {c["path"] for c in current}:
        return True
    try:
        a = apply_changes(plan, [Change(path=c["path"], value=c["value"]) for c in proposed])
        b = apply_changes(plan, [Change(path=c["path"], value=c["value"]) for c in current])
    except ChangeError:
        return True
    return json.dumps(a.model_dump(), sort_keys=True, default=str) != json.dumps(b.model_dump(), sort_keys=True, default=str)


def _decision_state(m: D.DecisionModule, viewer: str, turn: dict | None = None) -> dict:
    plan = store.plan
    if viewer not in [p.id for p in plan.people]:
        raise HTTPException(422, "unknown viewer")
    session = store.decision_session(m.id)
    out = D.state(m, plan, session, viewer, _linked_proposal(session))
    if out["proposal"]:
        out["proposal"]["outdated"] = _changes_differ(plan, out["proposal"].pop("changes"), out["changes"])
    if turn is not None:
        if turn.get("next") and out["next"] and turn["next"]["id"] == out["next"]["id"]:
            out["next"] = turn["next"]
        out["turn"] = {k: v for k, v in turn.items() if k != "next"}
    out["llm_available"] = ai.llm_available()
    return out


@app.get("/api/decisions")
def decision_list():
    return [_decision_summary(m) for m in D.MODULES.values()]


@app.get("/api/decisions/{mid}")
def decision_state(mid: str, viewer: str):
    return _decision_state(_decision_module(mid), viewer)


@app.post("/api/decisions/{mid}/step")
def decision_step(mid: str, body: DecisionStepIn):
    m = _decision_module(mid)
    plan = store.plan
    session = store.decision_session(mid)
    try:
        changed = D.apply_answers(m, plan, session, body.viewer, body.answers, body.preferences)
        if body.adjustments is not None:
            D.absorb(m, plan, session, body.viewer, body.adjustments)
            changed.append("adjustments")
    except (D.AnswerError, ChangeError) as e:
        raise HTTPException(422, str(e)) from None
    text = (body.text or "").strip() or None
    turn = D.take_turn(m, plan, session, body.viewer, text, body.focus, body.ask_next)
    plan_changed = bool(changed) or any(not m.question(e["question_id"]).per_partner for e in turn["extracted"])
    linked = _linked_proposal(session)
    if plan_changed and linked and linked["status"] != "pending":
        session.proposal_id = None  # a decided proposal no longer describes the new answers
    store.save_decision_session(session)
    return _decision_state(m, body.viewer, turn)


def _preferences_for(m: D.DecisionModule, plan: Plan, session: D.DecisionSession, candidate: Plan) -> dict:
    home = store.decision_session("buy-home")
    prefs = {key: value for key, value in home.preferences.items()
             if candidate.shared.property.enabled and key in ("date_flex", "budget_flex")}
    values, _ = D.resolve(m, plan, session)
    prefs.update({q.id: {pid: answer for pid, answer in session.preferences.get(q.id, {}).items()
                         if D._answers_for(q, values, pid)}
                  for q in m.questions if q.per_partner and session.preferences.get(q.id)})
    return prefs


def _comparison(m: D.DecisionModule, plan: Plan, session: D.DecisionSession, stress: StressIn | None):
    try:
        values, mine, own, variants = D.candidates(m, plan, session)
    except (D.AnswerError, ChangeError) as e:
        raise HTTPException(422, str(e)) from None
    prefs = _preferences_for(m, plan, session, mine)
    stated = {pid for answers in prefs.values() for pid in answers}
    try:
        return compare(plan, own, variants, preferences=prefs,
                       stress=stress.model_dump(exclude_none=True) if stress else None,
                       event_label=m.event_label, preference_label=len(stated) == len(plan.people),
                       event_of=lambda candidate: m.event(candidate, values))
    except ChangeError as e:
        raise HTTPException(422, str(e)) from None


@app.post("/api/decisions/{mid}/compare")
def decision_compare(mid: str, body: CompareIn):
    return _comparison(_decision_module(mid), store.plan, store.decision_session(mid), body.stress)


@app.put("/api/decisions/{mid}/options")
def decision_options(mid: str, body: OptionsIn):
    """Replace the couple's extra options for this decision. Nothing reaches the plan."""
    m = _decision_module(mid)
    session = store.decision_session(mid)
    try:
        D.set_options(m, store.plan, session, body.viewer, [o.model_dump() for o in body.options])
    except (D.AnswerError, ValueError) as e:
        raise HTTPException(422, str(e)) from None
    store.save_decision_session(session)
    return _decision_state(m, body.viewer)


@app.post("/api/decisions/{mid}/uncertainty")
def decision_uncertainty(mid: str, body: UncertaintyIn):
    """Illustrative spread for one option against the agreed plan, on matched random scenarios.

    Runs on request only. It varies inflation and investment returns around documented
    assumptions; it is not a probability of success.
    """
    from converge.engine.what_if import Uncertainty, _risk

    m = _decision_module(mid)
    plan = store.plan
    comparison = _comparison(m, plan, store.decision_session(mid), body.stress)
    column = next((c for c in comparison["columns"] if c["id"] == body.option_id), None)
    if column is None:
        raise HTTPException(404, "This option is no longer in the comparison.")
    option_plan = _apply(plan, [Change.model_validate(ch) for ch in column["changes"]])
    stress = body.stress.model_dump(exclude_none=True) if body.stress else {}
    risk = _risk((with_stress(plan, stress), with_stress(option_plan, stress)), Uncertainty())
    return dict(option_id=column["id"], title=column["title"], people=[p.name for p in plan.people], **risk)


@app.get("/api/decisions/{mid}/memory")
def decision_memory(mid: str, viewer: str):
    """The viewer's own discovery notes relevant to this decision. Never the partner's."""
    from converge.voice.routes import memory_db

    m = _decision_module(mid)
    if viewer not in [p.id for p in store.plan.people]:
        raise HTTPException(422, "unknown viewer")
    return dict(hints=D.memory_hints(m, store.plan, viewer, memory_db().items(viewer)))


@app.post("/api/decisions/{mid}/propose")
def decision_propose(mid: str, body: DecisionProposeIn):
    m = _decision_module(mid)
    plan = store.plan
    session = store.decision_session(mid)
    if body.remove:
        if m.id == "career-break":
            values, _ = D.resolve(m, plan, session)
            pid = values["person"]
            entry = D._career_entry(plan, pid)
            raw = [Change(path=f"people.{pid}.career_breaks",
                          value=[b.model_dump() for b in plan.person(pid).career_breaks if b != entry])]
        else:
            raw = m.remove(plan)
        changes = [c for c in raw if c.value != D.get_value(plan, c.path)]
        title = body.title or f"Remove from plan: {m.title.lower()}"
        if not changes:
            raise HTTPException(422, "This decision is not part of your agreed plan.")
    else:
        if body.author not in [p.id for p in plan.people]:
            raise HTTPException(422, "unknown partner")
        values, _ = D.resolve(m, plan, session)
        changes, errors = D.compile_changes(m, plan, session, values)
        if errors:
            raise HTTPException(422, errors[0])
        title = body.title or f"{m.title}: {m.headline(plan, values)}"
        if body.option_id is not None:
            comparison = _comparison(m, plan, session, body.stress)
            option = next((c for c in comparison["columns"] if c["id"] == body.option_id), None)
            if not option or not option["safe"]:
                raise HTTPException(422, "Choose an option that is safe under the current comparison.")
            if option["id"] != "your-plan":
                from converge.store import diff_plans

                # The chosen option becomes the couple's plan for this decision.
                chosen = _apply(plan, [Change.model_validate(ch) for ch in option["changes"]])
                changes = diff_plans(plan, chosen)
                try:
                    if option["overrides"]:
                        D.apply_answers(m, plan, session, body.author, option["overrides"], {})
                    if option["kind"] == "fix":
                        D.absorb(m, plan, session, body.author, changes)
                except (D.AnswerError, ChangeError) as e:
                    raise HTTPException(422, str(e)) from None
                session.options = [o for o in session.options if o.id != option["id"]]
                values, _ = D.resolve(m, plan, session)
                compiled, errors = D.compile_changes(m, plan, session, values)
                if not errors and _apply(plan, compiled) == chosen:
                    changes = compiled  # the proposal then matches the session exactly
                title = body.title or f"{m.title}: {m.headline(plan, values)}"
        if not changes:
            raise HTTPException(422, "This already matches your agreed plan.")
    brief = D.state(m, plan, session, body.author)["brief"]
    note = " ".join(f"{p['name']}: {p['summary']}." for p in brief["partners"] if p["summary"])[:1000]
    earlier = _linked_proposal(session)
    try:
        prop = store.propose(body.author, title, changes, "decision", note, both=m.id == "career-break")
        if earlier and earlier["status"] == "pending":
            store.supersede(earlier["id"], "Replaced by a newer version of this decision.")
    except (ChangeError, WorkflowError) as e:
        raise HTTPException(422, str(e)) from None
    if not body.remove:
        session.proposal_id = prop.id
        store.save_decision_session(session)
    return prop.model_dump()


@app.delete("/api/decisions/{mid}")
def decision_restart(mid: str, viewer: str):
    m = _decision_module(mid)
    store.clear_decision_session(m.id)
    return _decision_state(m, viewer)


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
        return what_if_compare(_apply(store.plan, body.draft), body)
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
def reset(prepared: bool = False):
    store.reset(prepared=prepared)
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
