"use client";

import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { api } from "@/lib/api";
import { chf, chfShort, monthLabel, pct, plural } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { DecisionComparison, DecisionState, StressLimit } from "@/lib/types";
import { StressButton, StressTag } from "../Decisions";
import { Button, clsx } from "../ui";

const COLORS = ["var(--color-ink)", "var(--color-p0)", "var(--color-p1)", "var(--color-warn)"];
type Option = DecisionComparison["columns"][number];

function ComparisonChart({ comparison, personId }: { comparison: DecisionComparison; personId?: string }) {
  const { columns, months } = comparison;
  const partners = columns.map((option) => option.people.find((person) => person.id === personId));
  const floor = partners[0]?.floor;
  const data = months.map((m, t) => ({
    m,
    ...Object.fromEntries(columns.map((option, i) => [option.id, partners[i]?.cash[t] ?? option.net_worth[t]])),
  }));
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-white p-3 sm:p-4">
      <h3 className="px-1 text-[14px] font-semibold">{partners[0] ? `${partners[0].name}’s cash` : "Household net worth"}</h3>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[12px] text-muted">
        {columns.map((option, i) => <li key={option.id}><span style={{ color: COLORS[i] }}>● </span>{option.title}</li>)}
        {floor !== undefined && <li>Dashed line · safety buffer</li>}
      </ul>
      <div className="h-56 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 14, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis dataKey="m" ticks={months.filter((m) => m.endsWith("-01"))} tickFormatter={(m) => m.slice(0, 4)} tick={{ fontSize: 11 }} minTickGap={8} />
            <YAxis tickFormatter={chfShort} tick={{ fontSize: 11 }} width={49} />
            <Tooltip labelFormatter={(m) => monthLabel(String(m))} formatter={(v) => chf(Number(v))} />
            {floor !== undefined && <ReferenceLine y={floor} stroke="var(--color-muted)" strokeDasharray="5 4" />}
            {columns.map((option, i) => <Line key={option.id} dataKey={option.id} name={option.title} stroke={COLORS[i]}
              strokeWidth={2} dot={false} isAnimationActive={false} />)}
            {partners.flatMap((person, i) => person?.breaches.map((t) => <ReferenceDot key={`${i}-${t}`}
              x={months[t]} y={person.cash[t]} r={3} stroke={COLORS[i]} fill="var(--color-bad-strong)" />) ?? [])}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function limitText(limit: StressLimit | null) {
  if (!limit) return "No mortgage";
  if (limit.kind === "unsafe") return "Already unsafe";
  return `${limit.kind === "cap" ? "At least " : ""}${pct(limit.value, 1)}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="border-t border-line py-2.5">
    <dt className="text-[12px] font-semibold text-ink">{label}</dt>
    <dd className="mt-0.5 text-[12.5px] leading-5 text-muted">{children}</dd>
  </div>;
}

function OptionCard({ option, index, disabled, onChoose }: {
  option: Option; index: number; disabled: boolean; onChoose: () => void;
}) {
  const goals = option.people.flatMap((person) => person.goals);
  return (
    <article className="flex w-[min(76vw,290px)] shrink-0 snap-start flex-col rounded-2xl border border-line bg-white p-4 md:w-auto">
      <div className="mb-3 md:min-h-20">
        <p className={clsx("text-[12px] font-medium", option.safe ? "text-good" : "text-bad-strong")}>
          {option.safe ? "Passes safety checks" : option.issue ?? "Fails safety checks"}
        </p>
        <h4 className="mt-1 text-[14px] leading-snug font-semibold"><span style={{ color: COLORS[index] }}>● </span>{option.title}</h4>
      </div>
      <dl className="mb-2">
        {option.people.map((person) => <Row key={person.id} label={person.name}>
          <span className={person.safe ? "text-good" : "text-bad-strong"}>{person.safe ? "Buffer holds" : "Below buffer"}</span>
          <br />{chf(person.min_cash)} low · {monthLabel(person.min_cash_month)}
        </Row>)}
        <Row label="Home">{option.home ? <>
          {monthLabel(option.home.month)} · {option.home.delay_months > 0 ? `${plural(option.home.delay_months, "month")} late` : "On time"}
          {!option.home.in_horizon && " · Outside projection"}
        </> : "No home purchase"}</Row>
        <Row label="Goals">{goals.length ? <ul>{goals.map((goal, i) => <li key={i}>
          {goal.name} {goal.reached_month && goal.slip_months !== null
            ? `slips ${plural(goal.slip_months, "month")} to ${monthLabel(goal.reached_month)}`
            : "misses its target within this projection"}
        </li>)}</ul> : "On track"}</Row>
        <Row label="Holds up to">
          <p>Mortgage rate · {limitText(option.robustness.mortgage)}</p>
          <p>Income drop · {limitText(option.robustness.income)}</p>
        </Row>
        <Row label="Fits what you said">
          {option.respects.map((note) => <p className="text-good" key={note}>{note}</p>)}
          {option.asks.map((note) => <p className="text-warn" key={note}>{note}</p>)}
          {!option.respects.length && !option.asks.length && "No stated preference affected"}
        </Row>
      </dl>
      <Button size="sm" variant="primary" className="mt-auto w-full" disabled={disabled || !option.safe} onClick={onChoose}>
        <Check size={14} /> Choose this option
      </Button>
    </article>
  );
}

export function DecisionReview({ state, onPropose, onRemove, onEdit }: {
  state: DecisionState; onPropose: (id: string) => Promise<void>; onRemove: () => Promise<void>; onEdit: () => void;
}) {
  const { scopedPerson, stress, setInboxOpen, ws } = useStore();
  const [request, setRequest] = useState<{ key: string; data?: DecisionComparison; error?: string }>({ key: "" });
  const [busy, setBusy] = useState(false);
  const id = state.module.id;
  const stressKey = JSON.stringify(stress);
  const key = JSON.stringify([id, state.changes, state.brief.partners, ws?.versions.length, stressKey]);

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      api.decisionCompare(id, JSON.parse(stressKey), ctrl.signal)
        .then((data) => setRequest({ key, data }))
        .catch((e: Error) => { if (e.name !== "AbortError") setRequest({ key, error: e.message }); });
    }, 150);
    return () => { window.clearTimeout(timer); ctrl.abort(); };
  }, [id, key, stressKey]);

  const comparison = request.data;
  const fresh = request.key === key;
  const pending = state.proposal?.status === "pending";
  async function choose(option: string) {
    setBusy(true);
    try { await onPropose(option); } finally { setBusy(false); }
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-[20px] font-semibold">Compare options</h2>
        <StressButton mortgageRate={comparison?.mortgage_rate} />
        <StressTag />
        <Button variant="ghost" size="sm" onClick={onEdit}>Edit brief</Button>
      </div>
      {!!Object.keys(stress).length && <p className="text-[13px] text-warn">Stress is temporary. The limits below start from each unstressed option.</p>}
      {pending && <Button variant="secondary" size="sm" onClick={() => setInboxOpen(true)}>Review pending proposal</Button>}
      {fresh && request.error && <p role="alert" className="text-[13.5px] text-bad-strong">{request.error}</p>}
      {!fresh && <p role="status" className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={16} className="animate-spin" /> Simulating options…</p>}
      {comparison && !(fresh && request.error) && <>
        <ComparisonChart comparison={comparison} personId={scopedPerson?.id} />
        <div aria-label="Options" tabIndex={0}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:grid md:auto-cols-fr md:grid-flow-col md:overflow-visible">
          {comparison.columns.map((option, i) => <OptionCard key={option.id} option={option} index={i}
            disabled={!fresh || busy || (option.id === "your-plan" && !state.changes.length) || (!!pending && !state.proposal?.outdated && option.id === "your-plan")}
            onChoose={() => void choose(option.id)} />)}
        </div>
        {fresh && !comparison.columns.some((option) => option.safe) && <p className="text-[13px] text-warn">No displayed option passes every safety check. Edit the brief or reset the stress test.</p>}
      </>}
      {state.active && <Button variant="ghost" size="sm" disabled={busy} onClick={onRemove}>Propose removing this decision</Button>}
    </div>
  );
}
