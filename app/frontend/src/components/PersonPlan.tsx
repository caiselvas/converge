"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { addMonths, chf, monthLabel, num } from "@/lib/format";
import { useDisplayed, useStore } from "@/lib/store";
import type { CareerBreak, Goal, Person } from "@/lib/types";
import { EditRow, PlanSection } from "./EditRow";
import { Button, MonthField, NumberField } from "./ui";

function Provenance({ pid }: { pid: string }) {
  const [l, setL] = useState<{ first_month: string; last_month: string; n_transactions: number; reconciliation: Record<string, number> } | null>(null);
  useEffect(() => {
    let active = true;
    api.provenance(pid).then((d) => { if (active) setL((d as { ledger: never }).ledger); }).catch(() => {});
    return () => { active = false; };
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
        <NumberField ariaLabel="Goal amount" min={1} value={g.target_chf} step={1000} width={150} onChange={(v) => setG({ ...g, target_chf: v })} />
        by
        <MonthField ariaLabel="Goal date" value={g.target_date} onChange={(v) => setG({ ...g, target_date: v })} />
      </div>
      <div className="flex flex-wrap gap-3 text-[12px] text-muted">
        <label>Priority
          <select value={g.priority} onChange={(e) => setG({ ...g, priority: e.target.value as Goal["priority"] })} className="ml-2 rounded-lg border border-line bg-white p-2 text-ink">
            <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>
        </label>
        <label>Measure
          <select value={g.measure} onChange={(e) => setG({ ...g, measure: e.target.value as Goal["measure"] })} className="ml-2 rounded-lg border border-line bg-white p-2 text-ink">
            <option value="cash">Cash</option><option value="liquid">Cash + investments</option>
          </select>
        </label>
      </div>
      <div className="flex items-center justify-between">
        {onRemove ? <Button size="sm" variant="ghost" onClick={onRemove}><Trash2 size={14} /> Remove</Button> : <span />}
        <div className="flex gap-2">
          {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
          <Button size="sm" variant="primary" disabled={!g.name.trim() || g.target_chf <= 0 || !g.target_date} onClick={() => onSave(g)}>Save</Button>
        </div>
      </div>
    </div>
  );
}

function BreakEditor({ value, onSave, onRemove, onCancel, min, submitLabel = "Save" }: { value: CareerBreak; onSave: (b: CareerBreak) => void; onRemove?: () => void; onCancel?: () => void; min: string; submitLabel?: string }) {
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
          <Button size="sm" variant="primary" onClick={() => onSave(b)}>{submitLabel}</Button>
        </div>
      </div>
    </div>
  );
}

export function newCareerBreak(person: Person, start: string): CareerBreak {
  let n = 1;
  while (person.career_breaks.some((b) => b.id === `cb${n}`)) n++;
  return { id: `cb${n}`, start: start > "2028-01" ? start : "2028-01", months: 6, income_pct: 0, one_off_cost_chf: 8000, label: "Career break" };
}

export function CareerBreakForm({ person, existing, onClose }: { person: Person; existing?: CareerBreak; onClose: () => void }) {
  const { draftPlan, setChange } = useStore();
  if (!draftPlan) return null;
  return <BreakEditor
    key={person.id}
    value={existing ?? newCareerBreak(person, draftPlan.assumptions.start)}
    min={draftPlan.assumptions.start}
    submitLabel={existing ? "Update" : "Add"}
    onSave={(value) => {
      const breaks = existing ? person.career_breaks.map((b) => b.id === existing.id ? value : b) : [...person.career_breaks, value];
      setChange(`people.${person.id}.career_breaks`, breaks);
      onClose();
    }}
  />;
}

export function PersonExpenses({ person, base }: { person: Person; base: Person }) {
  const { setChange } = useStore();
  const groups = [
    { label: "Essential spending", keys: ["essential", "housing"] },
    { label: "Flexible spending", keys: ["flexible"] },
    { label: "Irregular spending", keys: ["irregular"] },
  ];
  return (
    <>
      <PlanSection title="Income">
        <EditRow label="Net income" sub={`Observed ${chf(person.income_observed_monthly)}/mo`} value={chf(person.income_monthly)} changed={person.income_monthly !== base.income_monthly}>
          <NumberField ariaLabel="Net income" value={person.income_monthly} step={100} width={170} onChange={(v) => setChange(`people.${person.id}.income_monthly`, v)} />
        </EditRow>
      </PlanSection>
      {groups.map(({ label, keys }) => {
        const categories = person.categories.filter((c) => keys.includes(c.group));
        return categories.length > 0 && <PlanSection key={label} title={label}>
          {categories.map((c) => {
            const original = base.categories.find((b) => b.key === c.key);
            return (
              <EditRow key={c.key} label={c.label} value={chf(c.budget_monthly)}
                sub={`Observed ${chf(c.observed_monthly)}/mo${c.household ? " · Shared once you live together" : c.group === "irregular" ? " · Monthly provision" : ""}`}
                changed={original?.budget_monthly !== c.budget_monthly}>
                <NumberField ariaLabel={`${c.label} budget`} value={c.budget_monthly} step={c.budget_monthly >= 1000 ? 50 : 10} width={170}
                  onChange={(v) => setChange(`people.${person.id}.categories.${c.key}.budget_monthly`, v)} />
              </EditRow>
            );
          })}
        </PlanSection>;
      })}
      <details>
        <summary className="cursor-pointer text-[12.5px] font-medium text-accent">About this data</summary>
        <div className="mt-2"><Provenance pid={person.id} /></div>
      </details>
    </>
  );
}

export function PersonGoals({ person, base }: { person: Person; base: Person }) {
  const { setChange, viewer, draftPlan, idx } = useStore();
  const { current } = useDisplayed();
  const [addingGoal, setAddingGoal] = useState(false);
  const [addingBreak, setAddingBreak] = useState(false);
  const pid = person.id;
  const index = idx(pid);
  const r = current?.people[index];
  const home = current?.property;
  const start = draftPlan!.assumptions.start;
  const setGoals = (goals: Goal[]) => setChange(`people.${pid}.goals`, goals);
  const setBreaks = (bs: CareerBreak[]) => setChange(`people.${pid}.career_breaks`, bs);
  return (
    <>
      {pid !== viewer && <p className="text-[13px] text-muted">{person.name} approves changes you suggest here.</p>}
      <PlanSection title="Safety buffer">
        <EditRow label="Keep at least" sub="Default is 6 months of current spending, rounded up to CHF 1,000." value={chf(person.emergency_floor)} changed={person.emergency_floor !== base.emergency_floor}>
          <NumberField ariaLabel="Minimum safety buffer" value={person.emergency_floor} step={1000} width={170} onChange={(v) => setChange(`people.${pid}.emergency_floor`, v)} />
        </EditRow>
      </PlanSection>

      <PlanSection title="Goals" action={!addingGoal && <button type="button" aria-label="Add goal" onClick={() => setAddingGoal(true)} className="flex items-center gap-1 text-[13px] font-medium text-accent"><Plus size={14} /> Add</button>}>
        {person.goals.length === 0 && !addingGoal && <p className="py-3 text-[13px] text-muted">No goals yet.</p>}
        {person.goals.map((g) => {
          const st = r?.goals.find((x) => x.id === g.id);
          return (
            <EditRow key={g.id} label={g.name} sub={`${chf(st?.projected_chf)} projected · ${chf(g.target_chf)} target by ${monthLabel(g.target_date)}`}
              value={st ? <span className={st.met ? "text-good" : st.in_horizon ? "text-warn" : "text-muted"}>{st.met ? "On track" : st.in_horizon ? `${chf(st.shortfall_chf)} short` : "Outside projection"}</span> : null}
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
      </PlanSection>

      <PlanSection title="Career breaks" action={!addingBreak && <button aria-label="Add career break" onClick={() => setAddingBreak(true)} className="flex items-center gap-1 text-[13px] font-medium text-accent"><Plus size={14} /> Add</button>}>
        {person.career_breaks.length === 0 && !addingBreak && <p className="py-3 text-[13px] text-muted">No career breaks planned.</p>}
        {person.career_breaks.map((b) => (
          <EditRow key={b.id} label={`${b.label} · ${b.months} months`} sub={`From ${monthLabel(b.start)}${b.income_pct ? `, ${b.income_pct}% income` : ", no income"}`}
            value={b.one_off_cost_chf ? chf(b.one_off_cost_chf, { compact: true }) : null} changed={JSON.stringify(base.career_breaks) !== JSON.stringify(person.career_breaks)}>
            <BreakEditor value={b} min={start} onSave={(nb) => setBreaks(person.career_breaks.map((x) => (x.id === b.id ? nb : x)))} onRemove={() => setBreaks(person.career_breaks.filter((x) => x.id !== b.id))} />
          </EditRow>
        ))}
        {addingBreak && (
          <div className="pt-3">
            <BreakEditor value={newCareerBreak(person, start)} min={start}
              onSave={(b) => { setBreaks([...person.career_breaks, b]); setAddingBreak(false); }} onCancel={() => setAddingBreak(false)} />
          </div>
        )}
      </PlanSection>

      {home && <PlanSection title={pid === viewer ? "Your share of the home" : `${person.name}’s share of the home`}>
        <EditRow label="Upfront contribution" sub={monthLabel(home.purchase)} value={chf(home.contributions[index])} />
      </PlanSection>}
    </>
  );
}

function nextGoalId(goals: Goal[]): string {
  let n = 1;
  while (goals.some((g) => g.id === `user-${n}`)) n++;
  return `user-${n}`;
}
