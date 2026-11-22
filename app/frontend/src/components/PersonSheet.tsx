"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { addMonths, chf, monthLabel, num, pct } from "@/lib/format";
import { useDisplayed, useStore } from "@/lib/store";
import type { CareerBreak, Goal, Person } from "@/lib/types";
import { EditRow, Sheet, SheetSection } from "./Sheet";
import { Avatar, Button, MonthField, NumberField, clsx } from "./ui";

function Provenance({ pid }: { pid: string }) {
  const [l, setL] = useState<{ first_month: string; last_month: string; n_transactions: number; reconciliation: Record<string, number> } | null>(null);
  useEffect(() => {
    api.provenance(pid).then((d) => setL((d as { ledger: never }).ledger)).catch(() => setL(null));
  }, [pid]);
  if (!l) return null;
  return (
    <p className="text-[12.5px] leading-5 text-muted">
      Estimated from {num(l.n_transactions)} UBS synthetic transactions ({monthLabel(l.first_month)} – {monthLabel(l.last_month)}). The ledger
      reconciles with the reported balances to CHF {l.reconciliation.max_abs_error_balance_chain_chf.toFixed(2)}. Fixed bills use the last 12 months,
      variable spending the full period; irregular costs are kept as a monthly provision. Salary transactions reflect net pay.
    </p>
  );
}

function GoalEditor({ goal, onSave, onRemove, onCancel }: { goal: Goal; onSave: (g: Goal) => void; onRemove?: () => void; onCancel?: () => void }) {
  const [g, setG] = useState(goal);
  return (
    <div className="space-y-3 rounded-xl bg-page p-4">
      <input aria-label="Goal name" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })}
        className="h-9 w-full rounded-lg border border-line-strong bg-white px-3 text-[13.5px] outline-none focus:ring-2 focus:ring-accent/30" />
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <NumberField ariaLabel="Goal amount" value={g.target_chf} step={1000} width={150} onChange={(v) => setG({ ...g, target_chf: v })} />
        by
        <MonthField ariaLabel="Goal date" value={g.target_date} onChange={(v) => setG({ ...g, target_date: v })} />
      </div>
      <div className="flex items-center justify-between">
        {onRemove ? <Button size="sm" variant="ghost" onClick={onRemove}><Trash2 size={14} /> Remove</Button> : <span />}
        <div className="flex gap-2">
          {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
          <Button size="sm" variant="primary" disabled={!g.name.trim()} onClick={() => onSave(g)}>Save</Button>
        </div>
      </div>
    </div>
  );
}

function BreakEditor({ value, onSave, onRemove, onCancel, min }: { value: CareerBreak; onSave: (b: CareerBreak) => void; onRemove?: () => void; onCancel?: () => void; min: string }) {
  const [b, setB] = useState(value);
  return (
    <div className="space-y-3 rounded-xl bg-page p-4">
      <div className="grid grid-cols-2 gap-3 text-[12px] text-muted">
        <label>From<div className="mt-1"><MonthField ariaLabel="Break start" value={b.start} min={min} onChange={(v) => setB({ ...b, start: v })} /></div></label>
        <label>Length<div className="mt-1"><NumberField ariaLabel="Break months" value={b.months} min={1} max={36} step={1} prefix="" suffix="mo" width="100%" onChange={(v) => setB({ ...b, months: v })} /></div></label>
        <label>Income kept<div className="mt-1"><NumberField ariaLabel="Income kept" value={b.income_pct} min={0} max={100} step={10} prefix="" suffix="%" width="100%" onChange={(v) => setB({ ...b, income_pct: v })} /></div></label>
        <label>One-off costs<div className="mt-1"><NumberField ariaLabel="Break costs" value={b.one_off_cost_chf} step={1000} width="100%" onChange={(v) => setB({ ...b, one_off_cost_chf: v })} /></div></label>
      </div>
      <div className="flex items-center justify-between">
        {onRemove ? <Button size="sm" variant="ghost" onClick={onRemove}><Trash2 size={14} /> Remove</Button> : <span />}
        <div className="flex gap-2">
          {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
          <Button size="sm" variant="primary" onClick={() => onSave(b)}>Save</Button>
        </div>
      </div>
    </div>
  );
}

function PersonBody({ person, base, idx }: { person: Person; base: Person; idx: number }) {
  const { setChange, viewer, draftPlan } = useStore();
  const { current } = useDisplayed();
  const [addingGoal, setAddingGoal] = useState(false);
  const [addingBreak, setAddingBreak] = useState(false);
  const pid = person.id;
  const r = current?.people[idx];
  const extraDeduction = draftPlan?.assumptions.tax_rate ?? 0;
  const spending = person.categories.reduce((s, c) => s + c.budget_monthly, 0);
  const saving = person.income_monthly * (1 - extraDeduction) - spending;
  const start = draftPlan?.assumptions.start ?? "2027-01";

  const setGoals = (goals: Goal[]) => setChange(`people.${pid}.goals`, goals);
  const setBreaks = (bs: CareerBreak[]) => setChange(`people.${pid}.career_breaks`, bs);

  return (
    <>
      {pid !== viewer && (
        <p className="mt-4 rounded-lg bg-page px-3 py-2 text-[12.5px] text-muted">You can suggest changes — {person.name} approves them.</p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4">
        <div>
          <div className="text-[12px] text-muted">Saves per month</div>
          <div className={clsx("tnum mt-0.5 text-[22px] font-semibold tracking-tight", saving < 0 && "text-bad-strong")}>{chf(saving)}</div>
          {extraDeduction > 0 && <div className="text-[11.5px] text-muted">after {pct(extraDeduction, 1)} extra deduction</div>}
        </div>
        {r && (
          <div>
            <div className="text-[12px] text-muted">Lowest cash</div>
            <div className={clsx("tnum mt-0.5 text-[22px] font-semibold tracking-tight", r.breach && "text-bad-strong")}>{chf(r.min_cash, { compact: true })}</div>
            <div className="text-[11.5px] text-muted">{monthLabel(r.min_cash_month)}</div>
          </div>
        )}
      </div>

      <SheetSection title="Monthly budget">
        <EditRow label="Net income" sub={`Observed ${chf(person.income_observed_monthly)}`} value={chf(person.income_monthly)} changed={person.income_monthly !== base.income_monthly}>
          <NumberField ariaLabel="Net income" value={person.income_monthly} step={100} width={170} onChange={(v) => setChange(`people.${pid}.income_monthly`, v)} />
        </EditRow>
        {person.categories.map((c) => {
          const b = base.categories.find((x) => x.key === c.key);
          const isChanged = !!b && Math.abs(b.budget_monthly - c.budget_monthly) > 0.5;
          return (
            <EditRow key={c.key} label={c.label}
              sub={isChanged ? <span className="text-accent">was {chf(b!.budget_monthly)}</span> : c.household ? "Shared once you live together" : c.group === "irregular" ? "Monthly provision" : undefined}
              value={chf(c.budget_monthly)} changed={isChanged}>
              <div className="flex items-center gap-3">
                <NumberField ariaLabel={`${c.label} budget`} value={c.budget_monthly} step={c.budget_monthly >= 1000 ? 50 : 10} width={170}
                  onChange={(v) => setChange(`people.${pid}.categories.${c.key}.budget_monthly`, v)} />
                <span className="text-[12px] text-muted">avg {chf(c.observed_monthly)}</span>
              </div>
            </EditRow>
          );
        })}
      </SheetSection>

      <SheetSection title="Safety buffer">
        <EditRow label="Keep at least" sub="Cash should never fall below this" value={chf(person.emergency_floor)} changed={person.emergency_floor !== base.emergency_floor}>
          <NumberField ariaLabel="Minimum safety buffer" value={person.emergency_floor} step={1000} width={170} onChange={(v) => setChange(`people.${pid}.emergency_floor`, v)} />
        </EditRow>
      </SheetSection>

      <SheetSection title="Goals" action={!addingGoal && <button onClick={() => setAddingGoal(true)} className="flex items-center gap-1 text-[13px] font-medium text-accent"><Plus size={14} /> Add</button>}>
        {person.goals.length === 0 && !addingGoal && <p className="py-3 text-[13px] text-muted">No goals yet.</p>}
        {person.goals.map((g) => {
          const st = r?.goals.find((x) => x.id === g.id);
          return (
            <EditRow key={g.id} label={g.name} sub={`${chf(g.target_chf, { compact: true })} by ${monthLabel(g.target_date)}`}
              value={st ? <span className={st.met ? "text-good" : "text-warn"}>{st.met ? "On track" : `${chf(st.shortfall_chf, { compact: true })} short`}</span> : null}
              changed={JSON.stringify(base.goals.find((x) => x.id === g.id)) !== JSON.stringify(g)}>
              <GoalEditor goal={g} onSave={(ng) => setGoals(person.goals.map((x) => (x.id === g.id ? ng : x)))} onRemove={() => setGoals(person.goals.filter((x) => x.id !== g.id))} />
            </EditRow>
          );
        })}
        {addingGoal && (
          <div className="pt-3">
            <GoalEditor
              goal={{ id: nextGoalId(person.goals), name: "", target_chf: 20000, target_date: addMonths(start, 36), priority: "medium", measure: "cash", source: "user" }}
              onSave={(g) => { setGoals([...person.goals, g]); setAddingGoal(false); }}
              onCancel={() => setAddingGoal(false)}
            />
          </div>
        )}
      </SheetSection>

      <SheetSection title="Life events" action={!addingBreak && person.career_breaks.length === 0 && <button onClick={() => setAddingBreak(true)} className="flex items-center gap-1 text-[13px] font-medium text-accent"><Plus size={14} /> Career break</button>}>
        {person.career_breaks.length === 0 && !addingBreak && <p className="py-3 text-[13px] text-muted">No career breaks planned.</p>}
        {person.career_breaks.map((b) => (
          <EditRow key={b.id} label={`${b.label} · ${b.months} months`} sub={`From ${monthLabel(b.start)}${b.income_pct ? `, ${b.income_pct}% income` : ", no income"}`}
            value={b.one_off_cost_chf ? chf(b.one_off_cost_chf, { compact: true }) : null} changed={JSON.stringify(base.career_breaks) !== JSON.stringify(person.career_breaks)}>
            <BreakEditor value={b} min={start} onSave={(nb) => setBreaks(person.career_breaks.map((x) => (x.id === b.id ? nb : x)))} onRemove={() => setBreaks(person.career_breaks.filter((x) => x.id !== b.id))} />
          </EditRow>
        ))}
        {addingBreak && (
          <div className="pt-3">
            <BreakEditor value={{ id: "cb1", start: "2028-01", months: 6, income_pct: 0, one_off_cost_chf: 8000, label: "Career break" }} min={start}
              onSave={(b) => { setBreaks([b]); setAddingBreak(false); }} onCancel={() => setAddingBreak(false)} />
          </div>
        )}
      </SheetSection>

      <details className="mt-8">
        <summary className="cursor-pointer text-[12.5px] font-medium text-accent">About this data</summary>
        <div className="mt-2"><Provenance pid={pid} /></div>
      </details>
    </>
  );
}

function nextGoalId(goals: Goal[]): string {
  let n = 1;
  while (goals.some((g) => g.id === `user-${n}`)) n++;
  return `user-${n}`;
}

export function PersonSheet() {
  const { sheet, openSheet, plan, draftPlan } = useStore();
  if (!plan || !draftPlan || sheet?.kind !== "person") return null;
  const idx = draftPlan.people.findIndex((p) => p.id === sheet.id);
  const person = draftPlan.people[idx];
  return (
    <Sheet open onClose={() => openSheet(null)} title={
      <div className="flex items-center gap-3">
        <Avatar name={person.name} index={idx} size={34} />
        <div>
          <div className="text-[16px] font-semibold">{person.name}</div>
          <div className="text-[12px] text-muted">{person.age} · {person.city} · {chf(person.opening_cash, { compact: true })} in cash today</div>
        </div>
      </div>
    }>
      <PersonBody key={person.id} person={person} base={plan.people[idx]} idx={idx} />
    </Sheet>
  );
}
