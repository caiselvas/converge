"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { addMonths, chf, monthLabel, num } from "@/lib/format";
import { useDisplayed, useStore } from "@/lib/store";
import type { Goal, GoalStatus, Person } from "@/lib/types";
import { EditRow, PlanSection } from "./EditRow";
import { Avatar, Button, MonthField, NumberField, clsx } from "./ui";

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
      <PlanSection title="Tax and pension">
        <EditRow label="Income tax paid outside payroll" sub="Monthly budget for tax bills your employer doesn’t withhold" value={chf(person.income_tax_monthly ?? 0)}
          changed={(person.income_tax_monthly ?? 0) !== (base.income_tax_monthly ?? 0)}>
          <NumberField ariaLabel="Monthly income tax budget" value={person.income_tax_monthly ?? 0} max={100_000} step={50} width={170}
            onChange={(v) => setChange(`people.${person.id}.income_tax_monthly`, v)} />
        </EditRow>
        <EditRow label="Vested pension at plan start" sub="From your pension statement. Counts toward net worth, not available cash." value={chf(person.pension_opening_chf ?? 0)}
          changed={(person.pension_opening_chf ?? 0) !== (base.pension_opening_chf ?? 0)}>
          <NumberField ariaLabel="Vested pension at plan start" value={person.pension_opening_chf ?? 0} max={1e9} step={1000} width={170}
            onChange={(v) => setChange(`people.${person.id}.pension_opening_chf`, v)} />
        </EditRow>
        <EditRow label="Monthly pension credit" sub="Employee and employer savings credit together. Scales with pay kept during a break." value={chf(person.pension_credit_monthly ?? 0)}
          changed={(person.pension_credit_monthly ?? 0) !== (base.pension_credit_monthly ?? 0)}>
          <NumberField ariaLabel="Monthly occupational pension credit" value={person.pension_credit_monthly ?? 0} max={100_000} step={50} width={170}
            onChange={(v) => setChange(`people.${person.id}.pension_credit_monthly`, v)} />
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

function goalTone(st: GoalStatus | undefined) {
  if (!st) return { text: "", cls: "text-muted", bar: "bg-ink/60" };
  if (st.met) return { text: "On track", cls: "text-good", bar: "bg-good" };
  if (!st.in_horizon) return { text: "Beyond projection", cls: "text-muted", bar: "bg-ink/60" };
  return { text: `${chf(st.shortfall_chf, { compact: true })} short`, cls: "text-warn", bar: "bg-warn" };
}

/** One partner's ordinary financial goals: safety buffer and savings targets. */
export function PersonGoalsCard({ person, base, title }: { person: Person; base: Person; title?: boolean }) {
  const { setChange, viewer, draftPlan, idx } = useStore();
  const { current } = useDisplayed();
  const [adding, setAdding] = useState(false);
  const pid = person.id;
  const r = current?.people[idx(pid)];
  const start = draftPlan!.assumptions.start;
  const setGoals = (goals: Goal[]) => setChange(`people.${pid}.goals`, goals);
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-white px-4 pt-4 pb-2 sm:px-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        {title ? (
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Avatar name={person.name} index={idx(pid)} size={24} />{person.name}
          </h3>
        ) : <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Your goals</h3>}
        {!adding && <button type="button" aria-label={`Add goal for ${person.name}`} onClick={() => setAdding(true)}
          className="flex items-center gap-1 text-[13px] font-medium text-accent"><Plus size={14} /> Add goal</button>}
      </div>
      {pid !== viewer && <p className="text-[12px] text-muted">{person.name} approves changes you suggest here.</p>}
      <EditRow label="Safety buffer" sub="Cash to keep at all times. Default: 6 months of spending." value={chf(person.emergency_floor)}
        changed={person.emergency_floor !== base.emergency_floor}>
        <NumberField ariaLabel={`${person.name}'s minimum safety buffer`} value={person.emergency_floor} step={1000} width={170}
          onChange={(v) => setChange(`people.${pid}.emergency_floor`, v)} />
      </EditRow>
      {person.goals.map((g) => {
        const st = r?.goals.find((x) => x.id === g.id);
        const tone = goalTone(st);
        return (
          <EditRow key={g.id} label={g.name}
            sub={<span className="block">
              <span className="tnum">{chf(g.target_chf)} by {monthLabel(g.target_date)}{st ? ` · ${chf(st.projected_chf, { compact: true })} projected` : ""}</span>
              {st && <span className="mt-1.5 block h-1 max-w-[240px] overflow-hidden rounded-full bg-page ring-1 ring-line/60">
                <span className={clsx("block h-full rounded-full", tone.bar)} style={{ width: `${Math.max(0, Math.min(1, st.progress)) * 100}%` }} />
              </span>}
            </span>}
            value={<span className={clsx("text-[13px]", tone.cls)}>{tone.text}</span>}
            changed={JSON.stringify(base.goals.find((x) => x.id === g.id)) !== JSON.stringify(g)}>
            <GoalEditor goal={g} onSave={(ng) => setGoals(person.goals.map((x) => (x.id === g.id ? ng : x)))} onRemove={() => setGoals(person.goals.filter((x) => x.id !== g.id))} />
          </EditRow>
        );
      })}
      {person.goals.length === 0 && !adding && <p className="py-3 text-[13px] text-muted">No savings goals yet.</p>}
      {adding && (
        <div className="py-3">
          <GoalEditor
            goal={{ id: nextGoalId(person.goals), name: "", target_chf: 20000, target_date: addMonths(start, 36), priority: "medium", measure: "cash", source: "user" }}
            onSave={(g) => { setGoals([...person.goals, g]); setAdding(false); }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}
    </section>
  );
}

export function PersonCareerBreaks({ person }: { person: Person }) {
  if (!person.career_breaks.length) return null;
  return <PlanSection title="Career breaks">{person.career_breaks.map((b) => (
    <p key={b.id} className="py-2 text-[13px] text-muted">
      {b.label} · {b.months} months from {monthLabel(b.start)} · {b.income_pct}% income
    </p>
  ))}</PlanSection>;
}

function nextGoalId(goals: Goal[]): string {
  let n = 1;
  while (goals.some((g) => g.id === `user-${n}`)) n++;
  return `user-${n}`;
}
