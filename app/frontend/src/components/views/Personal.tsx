"use client";

import { Briefcase, Database, Plus, Target, Trash2, Wallet } from "lucide-react";
import { useEffect, useState } from "react";

import { CashChart, ChartLegend } from "@/components/charts/CashChart";
import { IssueCard } from "@/components/IssueCard";
import {
  Avatar, Badge, Button, Card, CardHeader, Field, InfoTip, LockedNote, MonthField, NumberField, Progress, Segmented, SourceTag, Stat, Toggle, clsx,
} from "@/components/ui";
import { api } from "@/lib/api";
import { addMonths, chf, monthLabel, num } from "@/lib/format";
import { getPath } from "@/lib/plan";
import { useDisplayed, useStore } from "@/lib/store";
import type { CareerBreak, Category, Person } from "@/lib/types";

const GROUPS: { id: Category["group"]; title: string; hint: string }[] = [
  { id: "housing", title: "Housing", hint: "Your own home costs" },
  { id: "essential", title: "Essentials", hint: "Hard to change quickly" },
  { id: "flexible", title: "Flexible", hint: "Everyday choices" },
  { id: "irregular", title: "Irregular", hint: "Not every month — kept as a monthly provision" },
];

function CategoryRow({ c, base, pid, color, cohabitFrom, max }: { c: Category; base?: Category; pid: string; color: string; cohabitFrom: string | null; max: number }) {
  const { setChange } = useStore();
  const changed = !!base && Math.abs(base.budget_monthly - c.budget_monthly) > 0.5;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-medium text-ink">{c.label}</span>
          {c.household && cohabitFrom && <Badge tone="neutral">shared from {monthLabel(cohabitFrom, true)}</Badge>}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="relative h-1.5 w-full max-w-[220px] rounded-full bg-page ring-1 ring-line/60">
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(c.budget_monthly / max) * 100}%`, background: color, opacity: 0.85 }} />
            <div className="absolute -top-1 h-3.5 w-0.5 rounded bg-ink/60" style={{ left: `${(c.observed_monthly / max) * 100}%` }} title="Historical average" />
          </div>
          <span className="tnum shrink-0 text-[11.5px] text-muted">
            {changed ? <span className="text-accent">was {chf(base!.budget_monthly)}</span> : <>avg {chf(c.observed_monthly)}</>}
          </span>
        </div>
      </div>
      <NumberField ariaLabel={`${c.label} monthly budget`} value={c.budget_monthly} step={c.budget_monthly >= 1000 ? 50 : 10} changed={changed}
        onChange={(v) => setChange(`people.${pid}.categories.${c.key}.budget_monthly`, v)} />
    </div>
  );
}

function Provenance({ pid }: { pid: string }) {
  const [data, setData] = useState<{ ledger: { first_month: string; last_month: string; n_transactions: number; reconciliation: Record<string, number>; closing_cash_chf: number } } | null>(null);
  useEffect(() => {
    api.provenance(pid).then((d) => setData(d as never)).catch(() => setData(null));
  }, [pid]);
  if (!data) return <div className="text-[12.5px] text-muted">Loading data lineage…</div>;
  const l = data.ledger;
  return (
    <div className="space-y-1.5 text-[12.5px] leading-5 text-ink-2">
      <p>
        Estimated from <b>{num(l.n_transactions)}</b> synthetic transactions, {monthLabel(l.first_month)} – {monthLabel(l.last_month)}. Fixed bills use the
        last 12 months; variable spending the full period. Irregular categories (travel, unplanned costs) are kept as a monthly provision instead of being extrapolated from single events.
      </p>
      <p>
        Ledger reconciliation against <code>synthetic-cash-balances.csv</code>: max difference{" "}
        <b className="tnum">CHF {l.reconciliation.max_abs_error_balance_chain_chf.toFixed(2)}</b> over all months — the opening balance plus every
        transaction equals the reported closing balance of {chf(l.closing_cash_chf)}.
      </p>
      <p className="text-muted">Investments are a single snapshot (2025-01-01) with no transaction history; Converge grows them at the assumed return.</p>
    </div>
  );
}

function BreakEditor({ person, base }: { person: Person; base?: Person }) {
  const { setChange, draftPlan } = useStore();
  const path = `people.${person.id}.career_breaks`;
  const breaks = person.career_breaks;
  const update = (list: CareerBreak[]) => setChange(path, list);
  const start = draftPlan?.assumptions.start ?? "2027-01";
  const end = addMonths(start, (draftPlan?.assumptions.horizon_months ?? 72) - 1);
  const changed = base ? JSON.stringify(base.career_breaks) !== JSON.stringify(breaks) : false;
  return (
    <div className="space-y-3">
      {breaks.length === 0 && <p className="text-[13px] text-muted">No life events planned. Add a career break — sabbatical, retraining or parental leave — to see how it affects both partners.</p>}
      {breaks.map((b, k) => {
        const set = (patch: Partial<CareerBreak>) => update(breaks.map((x, j) => (j === k ? { ...x, ...patch } : x)));
        return (
          <div key={b.id} className={clsx("rounded-xl border p-4", changed ? "border-accent/50 bg-[#f2fafa]" : "border-line bg-page/50")}>
            <div className="flex items-center justify-between">
              <div className="text-[13.5px] font-semibold">{b.label}: {b.months} months from {monthLabel(b.start)}</div>
              <Button size="sm" variant="ghost" aria-label="Remove career break" onClick={() => update(breaks.filter((_, j) => j !== k))}><Trash2 size={14} /></Button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-[12px] font-medium text-muted">Starts
                <div className="mt-1"><MonthField ariaLabel="Break start" value={b.start} min={start} max={end} onChange={(v) => set({ start: v })} /></div>
              </label>
              <label className="text-[12px] font-medium text-muted">Length
                <div className="mt-1"><NumberField ariaLabel="Break length in months" value={b.months} step={1} min={1} max={36} prefix="" suffix="months" width={150} onChange={(v) => set({ months: v })} /></div>
              </label>
              <label className="text-[12px] font-medium text-muted">Income during the break
                <div className="mt-1"><NumberField ariaLabel="Income during break, percent" value={b.income_pct} step={10} min={0} max={100} prefix="" suffix="%" width={150} onChange={(v) => set({ income_pct: v })} /></div>
              </label>
              <label className="text-[12px] font-medium text-muted">One-off costs (courses, travel)
                <div className="mt-1"><NumberField ariaLabel="One-off costs" value={b.one_off_cost_chf} step={500} width={150} onChange={(v) => set({ one_off_cost_chf: v })} /></div>
              </label>
            </div>
          </div>
        );
      })}
      <Button size="sm" variant="secondary" onClick={() => update([...breaks, { id: `cb${Date.now() % 100000}`, start: "2028-01", months: 6, income_pct: 0, one_off_cost_chf: 8000, label: "Career break" }])}>
        <Plus size={14} /> Add career break
      </Button>
    </div>
  );
}

export function Personal() {
  const { ws, plan, draftPlan, viewer, personalFocus, setPersonalFocus, setChange, name, draft, preview } = useStore();
  const hasDraft = draft.length > 0 || !!preview;
  const { current, base } = useDisplayed();
  const pid = personalFocus ?? viewer;
  if (!plan || !draftPlan || !ws) return null;
  const i = draftPlan.people.findIndex((p) => p.id === pid);
  const person = draftPlan.people[i];
  const basePerson = plan.people[i];
  const color = i === 0 ? "var(--color-p0)" : "var(--color-p1)";
  const own = pid === viewer;
  const hh = draftPlan.shared.household;
  const pr = draftPlan.shared.property;
  const cohabitFrom = hh.enabled ? (pr.enabled && pr.purchase < hh.move_in ? pr.purchase : hh.move_in) : pr.enabled ? pr.purchase : null;
  const series = current?.series[pid];
  const r = current?.people[i];
  const spending = person.categories.reduce((s, c) => s + c.budget_monthly, 0);
  const catMax = Math.max(1, ...person.categories.flatMap((c) => [c.budget_monthly, c.observed_monthly])) * 1.05;
  const observedSpending = person.categories.reduce((s, c) => s + c.observed_monthly, 0);
  const taxRate = draftPlan.assumptions.tax_rate;
  const firstMonthSaving = person.income_monthly * (1 - taxRate) - spending;
  const personIssues = current?.issues.filter((x) => x.person === pid) ?? [];

  const pathChanged = (path: string) => JSON.stringify(getPath(plan, path)) !== JSON.stringify(getPath(draftPlan, path));

  return (
    <div className="fade-up space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={person.name} index={i} size={40} />
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">{person.name}&apos;s financial twin</h1>
            <p className="text-[13px] text-muted">
              {person.age}, {person.city} · {person.employment_status} · UBS synthetic profile {person.id}
            </p>
          </div>
        </div>
        <Segmented ariaLabel="Partner" value={pid} onChange={(v) => setPersonalFocus(v)} options={ws.people.map((p, k) => ({ value: p.id, label: <span className="flex items-center gap-1.5"><Avatar name={p.name} index={k} size={18} />{p.name}{p.id === viewer ? " (you)" : ""}</span> }))} />
      </div>
      {!own && <LockedNote owner={person.name} />}

      <Card className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Cash today" value={chf(person.opening_cash, { compact: true })} sub={<span className="flex items-center gap-1.5">{monthLabel(person.opening_cash_date)} <SourceTag kind="dataset" /></span>} />
        <Stat label="Investments" value={chf(person.investments, { compact: true })} sub={<span className="flex items-center gap-1.5">snapshot {person.investments_as_of.slice(0, 7)} <SourceTag kind="dataset" /></span>} tip="Portfolio value from the dataset snapshot. Not counted as liquidity for the safety buffer." />
        <Stat label="Net income" value={`${chf(person.income_monthly)}`} sub={<span className="flex items-center gap-1.5">per month <SourceTag kind={person.income_monthly !== person.income_observed_monthly ? "user" : "derived"} /></span>} tip="Average net salary over the last 12 months of the ledger (after social contributions, before income tax)." />
        <Stat label="Spending" value={chf(spending)} sub={spending !== observedSpending ? `was ${chf(observedSpending)} historically` : "per month, from transactions"} />
        <Stat label="Saving today" value={chf(firstMonthSaving)} sub={`per month after ${Math.round(taxRate * 100)}% tax estimate`} tone={firstMonthSaving < 0 ? "bad" : undefined} tip="Income − estimated income tax − spending, before any shared plans. The ledger contains no tax payments, so tax is an explicit, editable assumption." />
      </Card>

      {personIssues.length > 0 && <div className="grid gap-3 md:grid-cols-2">{personIssues.map((x) => <IssueCard key={x.id} issue={x} />)}</div>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader icon={<Wallet size={17} />} title="Monthly spending" subtitle={<>Estimated from UBS transactions. Adjust a budget to see the effect. <span className="whitespace-nowrap">Marker = historical average.</span></>} />
          <div className="px-5 pb-4 sm:px-6">
            {GROUPS.map((g) => {
              const cats = person.categories.filter((c) => c.group === g.id);
              if (!cats.length) return null;
              return (
                <div key={g.id} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
                  <div className="flex items-baseline justify-between">
                    <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{g.title}</div>
                    <div className="text-[11.5px] text-subtle">{g.hint}</div>
                  </div>
                  <div className="divide-y divide-line/70">
                    {cats.map((c) => (
                      <CategoryRow key={c.key} c={c} base={basePerson.categories.find((x) => x.key === c.key)} pid={pid} color={color} cohabitFrom={cohabitFrom} max={catMax} />
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="mt-3 border-t border-line pt-3">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] font-medium text-accent"><Database size={13} /> Where do these numbers come from?</summary>
                <div className="mt-2"><Provenance pid={pid} /></div>
              </details>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Projection" subtitle={`${person.name}'s own cash under the current plan${hasDraft ? " — dashed: agreed plan" : ""}`} />
            {current && <div className="px-2 sm:px-4"><CashChart current={current} base={hasDraft ? base : null} only={i} height={220} /></div>}
            <div className="px-5 pt-1 pb-4 sm:px-6"><ChartLegend names={[person.name]} showBase={hasDraft} showBreak={current!.events.some((e) => e.kind === "career_break")} /></div>
            {r && series && (
              <div className="grid grid-cols-3 gap-4 border-t border-line px-5 py-4 sm:px-6">
                <Stat label="Lowest cash" value={chf(r.min_cash, { compact: true })} sub={monthLabel(r.min_cash_month)} tone={r.breach ? "bad" : undefined} />
                <Stat label="End cash" value={chf(r.end_cash, { compact: true })} sub={monthLabel(current!.months[current!.months.length - 1])} />
                <Stat label="Net worth" value={chf(r.end_net_worth, { compact: true })} sub="at end of plan" />
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Income & safety" />
            <div className="divide-y divide-line px-5 pb-3 sm:px-6">
              <Field label="Net income" hint={`Observed ${chf(person.income_observed_monthly)}/month`} changedFrom={pathChanged(`people.${pid}.income_monthly`) ? chf(basePerson.income_monthly) : null}>
                <NumberField ariaLabel="Net monthly income" value={person.income_monthly} step={100} changed={pathChanged(`people.${pid}.income_monthly`)} onChange={(v) => setChange(`people.${pid}.income_monthly`, v)} />
              </Field>
              <Field label={<span className="flex items-center gap-1">Minimum safety buffer <InfoTip content="A hard limit: Converge flags any month in which this partner's own cash falls below it. Default: 6 months of current spending." /></span>}
                hint="Cash should never fall below this" changedFrom={pathChanged(`people.${pid}.emergency_floor`) ? chf(basePerson.emergency_floor) : null}>
                <NumberField ariaLabel="Minimum safety buffer" value={person.emergency_floor} step={1000} width={140} changed={pathChanged(`people.${pid}.emergency_floor`)} onChange={(v) => setChange(`people.${pid}.emergency_floor`, v)} />
              </Field>
              {person.bonus_observed_annual > 0 && (
                <Field label="Count observed bonus" hint={`${chf(person.bonus_observed_annual)}/year observed — not guaranteed`}>
                  <Toggle label="Count bonus" checked={person.include_bonus} onChange={(v) => setChange(`people.${pid}.include_bonus`, v)} />
                </Field>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Target size={17} />} title="Personal goals" subtitle="From the UBS goals dataset. Funded in priority order, so the same franc is never counted twice." />
          <div className="space-y-4 px-5 pb-5 sm:px-6">
            {person.goals.length === 0 && <p className="text-[13px] text-muted">No goals in the dataset for this profile.</p>}
            {person.goals.map((g) => {
              const st = r?.goals.find((x) => x.id === g.id);
              const pathD = `people.${pid}.goals.${g.id}.target_date`;
              const pathA = `people.${pid}.goals.${g.id}.target_chf`;
              return (
                <div key={g.id} className="rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold">{g.name}</span>
                      <Badge tone={g.priority === "high" ? "info" : "neutral"}>{g.priority} priority</Badge>
                    </div>
                    {st && <span className={clsx("text-[12.5px] font-medium", st.met ? "text-good" : st.in_horizon ? "text-warn" : "text-muted")}>{st.met ? "On track" : st.in_horizon ? `${chf(st.shortfall_chf, { compact: true })} short` : "Beyond horizon"}</span>}
                  </div>
                  {st && <Progress value={st.progress} tone={st.met ? "good" : "warn"} className="mt-2.5" />}
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[12.5px] text-muted">
                    <NumberField ariaLabel={`${g.name} target`} value={g.target_chf} step={1000} width={150} changed={pathChanged(pathA)} onChange={(v) => setChange(pathA, v)} />
                    by
                    <MonthField ariaLabel={`${g.name} target date`} value={g.target_date} changed={pathChanged(pathD)} onChange={(v) => setChange(pathD, v)} />
                    <span>measured on {g.measure === "cash" ? "cash" : "cash + investments"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader icon={<Briefcase size={17} />} title="Life events" subtitle="Career breaks change income for a period; everything else keeps running." />
          <div className="px-5 pb-5 sm:px-6">
            <BreakEditor person={person} base={basePerson} />
          </div>
        </Card>
      </div>
      {!own && <p className="text-center text-[12px] text-muted">Edits to {name(pid)}&apos;s twin are sent to {name(pid)} for approval.</p>}
    </div>
  );
}
