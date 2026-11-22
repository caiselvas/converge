"use client";

import { Check, Copy, Info, Sparkles } from "lucide-react";
import { useState } from "react";

import { api } from "@/lib/api";
import { chf, monthLabel, pct, plural } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { ComparisonColumn, DecisionState, RiskSummary, StressLimit } from "@/lib/types";
import { Avatar, Button, clsx } from "../ui";
import { LabelChip } from "./OptionCards";
import { KIND_LABEL } from "./registry";

function limitText(limit: StressLimit | null) {
  if (!limit) return "No mortgage";
  if (limit.kind === "unsafe") return "Not safe today";
  return `${limit.kind === "cap" ? "At least " : ""}${pct(limit.value, 1)}`;
}

function PartnerImpact({ col, reference }: { col: ComparisonColumn; reference: ComparisonColumn }) {
  const { idx } = useStore();
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {col.people.map((p) => {
        const before = reference.people.find((x) => x.id === p.id);
        const delta = before && col.id !== reference.id ? p.min_cash - before.min_cash : null;
        return (
          <div key={p.id} className={clsx("rounded-xl p-3 ring-1", p.safe ? "bg-white ring-line" : "bg-bad-soft ring-bad/20")}>
            <p className="flex items-center gap-1.5 text-[14px] font-semibold"><Avatar name={p.name} index={idx(p.id)} size={20} /> {p.name}</p>
            <p className="mt-2 text-[12px] text-muted">Lowest cash · {monthLabel(p.min_cash_month)}</p>
            <p className="tnum text-[18px] font-semibold tracking-tight">{chf(p.min_cash)}</p>
            <p className={clsx("tnum text-[13px] font-medium", p.safe ? "text-good" : "text-bad-strong")}>
              {p.safe ? `${chf(p.headroom)} above` : `${chf(-p.headroom)} below`} the {chf(p.floor, { compact: true })} buffer
            </p>
            {delta !== null && Math.abs(delta) >= 1 && <p className={clsx("tnum mt-0.5 text-[12.5px]", delta > 0 ? "text-good" : "text-bad-strong")}>
              {chf(delta, { sign: true })} vs your plan
            </p>}
            {p.goals.map((g) => <p key={g.name} className="mt-1.5 text-[12.5px] text-warn">
              {g.name} {g.reached_month && g.slip_months !== null ? `slips ${plural(g.slip_months, "month")} to ${monthLabel(g.reached_month)}` : "misses its target in this projection"}
            </p>)}
          </div>
        );
      })}
    </div>
  );
}

function Uncertainty({ decision, col }: { decision: string; col: ComparisonColumn }) {
  const { stress, toast } = useStore();
  const [result, setResult] = useState<RiskSummary | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try { setResult(await api.decisionUncertainty(decision, col.id, stress)); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  }
  if (!result || result.option_id !== col.id) return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-page px-3 py-2.5">
      <p className="text-[13px] text-muted">How sensitive is this to markets and inflation?</p>
      <Button size="sm" variant="secondary" loading={busy} onClick={() => void run()}>Show illustrative range</Button>
    </div>
  );
  const [low, mid, high] = result.paired_worth_delta;
  return (
    <div className="space-y-2 rounded-xl bg-page p-3 text-[13px]">
      <p className="font-semibold text-ink">Illustrative range · {result.trials} matched scenarios</p>
      <p className="leading-5 text-ink-2">
        Against your agreed plan, household net worth at the end changes by <b className="tnum">{chf(low, { sign: true, compact: true })}</b> to{" "}
        <b className="tnum">{chf(high, { sign: true, compact: true })}</b> in the middle 80% of scenarios (median {chf(mid, { sign: true, compact: true })}).
      </p>
      <ul className="tnum grid gap-1 sm:grid-cols-3">
        {[...result.people, "Either of you"].map((who, i) => <li key={who} className="rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-line">
          <span className="block text-[12px] text-muted">{who} below buffer</span>
          {result.baseline_breaches[i]} → <b>{result.scenario_breaches[i]}</b> <span className="text-muted">of {result.trials}</span>
        </li>)}
      </ul>
      <p className="flex gap-1.5 text-[12px] leading-5 text-muted"><Info size={13} className="mt-0.5 shrink-0" />
        Both plans face the same simulated shocks: inflation within ±{pct(result.inflation_spread, 1)} and {pct(result.investment_volatility, 0)} yearly investment volatility.
        These are assumed ranges on synthetic data, not a probability that the plan succeeds.
      </p>
    </div>
  );
}

export function OptionDetail({ state, col, reference, otherName, busy, onChoose, onCopy, canCopy }: {
  state: DecisionState; col: ComparisonColumn; reference: ComparisonColumn; otherName: string; busy: boolean;
  onChoose: () => void; onCopy: () => void; canCopy: boolean;
}) {
  const { openAssistant, setInboxOpen } = useStore();
  const pending = state.proposal?.status === "pending";
  const agreed = col.kind === "yours" && !state.changes.length;
  const samePending = pending && !state.proposal?.outdated && col.kind === "yours";
  const engine = col.kind === "variant" || col.kind === "fix";
  return (
    <section aria-label={`Selected option: ${col.title}`} className="min-w-0 space-y-4 rounded-2xl border border-line bg-white p-4 shadow-card sm:p-5">
      <div>
        <p className="text-[12.5px] font-medium text-muted">{KIND_LABEL[col.kind]}</p>
        <h3 className="mt-0.5 text-[19px] leading-snug font-semibold tracking-tight">{col.title}</h3>
        {col.summary.length > 0 && <p className="mt-1 text-[13.5px] text-muted">{col.summary.join(" · ")}</p>}
        <p className={clsx("mt-2 text-[14px] font-medium", col.safe ? "text-good" : "text-bad-strong")}>
          {col.safe ? "Passes every safety check" : col.issue ?? "Fails a safety check"}
        </p>
        {col.labels.length > 0 && <div className="mt-2 space-y-1">
          {col.labels.map((l) => <div key={l.id} className="flex flex-wrap items-center gap-2"><LabelChip label={l} /><span className="text-[12.5px] text-muted">{l.detail}</span></div>)}
        </div>}
      </div>

      {col.kind !== "yours" && col.tradeoff && <div className="rounded-xl bg-page px-3 py-2.5">
        <p className="text-[12px] font-semibold text-muted">Compared with your plan</p>
        <p className="mt-0.5 text-[14px] leading-6 text-ink">{col.tradeoff}</p>
      </div>}

      <PartnerImpact col={col} reference={reference} />

      <dl className="grid gap-x-4 gap-y-2 text-[13px] sm:grid-cols-2">
        <div><dt className="text-muted">Holds up to a mortgage rate of</dt><dd className="font-medium">{limitText(col.robustness.mortgage)}</dd></div>
        <div><dt className="text-muted">Holds up to an income drop of</dt><dd className="font-medium">{limitText(col.robustness.income)}</dd></div>
      </dl>

      {(col.respects.length > 0 || col.asks.length > 0) && <div className="text-[13px] leading-5">
        <p className="font-semibold text-ink">Fits what you said</p>
        {col.respects.map((n) => <p key={n} className="mt-0.5 flex gap-1.5 text-good"><Check size={14} className="mt-0.5 shrink-0" />{n}</p>)}
        {col.asks.map((n) => <p key={n} className="mt-0.5 text-warn">{n}</p>)}
      </div>}
      {col.soft_issues.length > 0 && <ul className="space-y-0.5 text-[13px] text-warn">{col.soft_issues.map((s) => <li key={s}>{s}</li>)}</ul>}

      <Uncertainty decision={state.module.id} col={col} />

      <div className="space-y-2 border-t border-line pt-4">
        {pending && <button type="button" onClick={() => setInboxOpen(true)} className="min-h-10 text-left text-[13.5px] text-warn hover:underline">
          {state.proposal?.outdated ? "Your proposal is out of date. Choosing again replaces it." : `Waiting for ${otherName} to approve. Review the proposal`}
        </button>}
        <Button variant="primary" size="lg" className="w-full" loading={busy} disabled={!col.safe || agreed || samePending} onClick={onChoose}>
          {agreed ? "This is your agreed plan" : samePending ? `Sent to ${otherName}` : `Choose and propose to ${otherName}`}
        </Button>
        {!col.safe && <p className="text-[12.5px] text-muted">Only options that pass every safety check can be proposed.</p>}
        <div className="flex flex-wrap gap-2">
          {engine && canCopy && <Button size="sm" variant="secondary" onClick={onCopy}><Copy size={14} /> Edit a copy</Button>}
          <Button size="sm" variant="ghost" onClick={() => openAssistant({ decision: state.module.id,
            prompt: `Explain the trade-offs of “${col.title}” for each of us.` })}><Sparkles size={14} /> Ask about this option</Button>
        </div>
      </div>
    </section>
  );
}
