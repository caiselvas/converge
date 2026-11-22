"use client";

import { ArrowRight, Check, Loader2, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { chf, monthLabel, pct } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Change, DecisionState, Evaluation, PersonResult, RecResponse, Recommendation, SimResponse } from "@/lib/types";
import { CashChart, ChartLegend } from "../charts/CashChart";
import { StressTag } from "../Decisions";
import { Explanation } from "../Plan";
import { Avatar, Button, StatusPill, clsx } from "../ui";

function verdict(ev: Evaluation) {
  const hard = ev.issues.find((i) => i.severity === "hard");
  const soft = ev.issues.find((i) => i.severity === "soft");
  if (hard) return { title: `${hard.title}.`, detail: hard.detail };
  if (soft) return { title: `${soft.title}.`, detail: soft.detail };
  return { title: "Under these assumptions, this plan works for both of you.", detail: "Both partners stay above their safety buffers in every month and every goal is met." };
}

function Delta({ v, good = "up" }: { v: number; good?: "up" | "down" }) {
  if (Math.abs(v) < 1) return <span className="text-subtle">no change</span>;
  const better = good === "up" ? v > 0 : v < 0;
  return <span className={clsx("tnum", better ? "text-good" : "text-bad-strong")}>{chf(v, { sign: true, compact: Math.abs(v) >= 10_000 })}</span>;
}

function PartnerImpact({ p, before }: { p: PersonResult; before?: PersonResult }) {
  const { idx } = useStore();
  const missed = p.goals.filter((g) => g.in_horizon && !g.met);
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[14px] font-semibold"><Avatar name={p.name} index={idx(p.id)} size={22} />{p.name}</span>
        <span className={clsx("rounded-full px-2 py-0.5 text-[11.5px] font-medium", p.breach ? "bg-bad-soft text-bad-strong" : "bg-good-soft text-good")}>
          {p.breach ? "Below safety buffer" : "Buffer kept"}
        </span>
      </div>
      <dl className="mt-3 space-y-1.5 text-[13px]">
        <div className="flex justify-between gap-3"><dt className="text-muted">Lowest cash</dt>
          <dd className="tnum text-right"><b>{chf(p.min_cash)}</b> <span className="text-muted">· {monthLabel(p.min_cash_month)}</span></dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">Above safety buffer</dt>
          <dd className={clsx("tnum", p.headroom < 0 ? "text-bad-strong" : "text-ink")}>{chf(p.headroom)}</dd></div>
        {before && <div className="flex justify-between gap-3"><dt className="text-muted">Lowest cash vs agreed plan</dt><dd><Delta v={p.min_cash - before.min_cash} /></dd></div>}
        {before && <div className="flex justify-between gap-3"><dt className="text-muted">Net worth at the end vs agreed plan</dt><dd><Delta v={p.end_net_worth - before.end_net_worth} /></dd></div>}
      </dl>
      {missed.length > 0 && <ul className="mt-2 space-y-0.5 text-[12.5px] text-warn">
        {missed.map((g) => <li key={g.id}>{g.name}: {chf(g.shortfall_chf)} short by {monthLabel(g.target_date)}</li>)}
      </ul>}
    </div>
  );
}

function DecisionFacts({ id, ev, sim }: { id: string; ev: Evaluation; sim: SimResponse }) {
  const { name } = useStore();
  const rows: { label: string; value: React.ReactNode; tone?: string }[] = [];
  const pr = ev.property;
  if (id === "buy-home" && pr) {
    const aff = pr.affordability;
    rows.push({ label: "Price and purchase", value: `${chf(pr.price)} · ${monthLabel(pr.purchase)}` });
    rows.push({ label: "Upfront: deposit and fees", value: `${ev.people[0].name} ${chf(pr.contributions[0], { compact: true })} · ${ev.people[1].name} ${chf(pr.contributions[1], { compact: true })}` });
    rows.push({ label: "Mortgage", value: chf(pr.mortgage) });
    rows.push({ label: "Monthly home costs, first full month", value: `${chf(pr.monthly_interest + pr.monthly_maintenance + pr.monthly_amortization)} incl. ${chf(pr.monthly_amortization)} amortisation` });
    if (aff) rows.push({
      label: "Indicative affordability", tone: aff.passes ? "text-good" : "text-bad-strong",
      value: `${pct(aff.ratio, 1)} of usual net income · limit ${pct(aff.max_ratio)}${aff.passes ? "" : ` · passes up to ${chf(aff.max_price, { compact: true })}`}`,
    });
    if (!pr.in_horizon) rows.push({ label: "Purchase", value: "After the end of the projection", tone: "text-warn" });
  }
  const t = ev.household.joint_transfers.findIndex((x) => x > 0);
  if ((id === "move-in" || id === "buy-home") && t >= 0) {
    rows.push({
      label: `Joint account contributions · ${monthLabel(ev.months[t])}`,
      value: ev.people.map((p) => `${p.name} ${chf(ev.series[p.id].household[t])}`).join(" · "),
    });
  }
  if (id === "have-child") {
    for (const child of ev.children) {
      const care = child.costs.findIndex((c) => c.childcare > 0);
      const first = child.costs.findIndex((c) => c.everyday > 0);
      const i = care >= 0 ? care : first;
      if (i >= 0) rows.push({ label: `Net child cost · ${monthLabel(ev.months[i])}`, value: `${chf(child.costs[i].net_cost)}/month after the family allowance` });
      if (first < 0) rows.push({ label: child.label, value: "Born after the end of the projection", tone: "text-warn" });
    }
    for (const p of ev.people) {
      const loss = sim.evaluation.series[p.id];
      const before = sim.base?.series[p.id];
      if (!loss || !before) continue;
      const diff = loss.income.reduce((a, b) => a + b, 0) - before.income.reduce((a, b) => a + b, 0);
      if (Math.abs(diff) >= 1) rows.push({ label: `${name(p.id)}’s income over the projection`, value: <Delta v={diff} /> });
    }
  }
  if (!rows.length) return null;
  return (
    <dl className="divide-y divide-line rounded-2xl border border-line bg-white px-4">
      {rows.map((r) => (
        <div key={r.label} className="flex flex-col gap-0.5 py-2.5 text-[13px] sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <dt className="text-muted">{r.label}</dt>
          <dd className={clsx("tnum font-medium sm:text-right", r.tone ?? "text-ink")}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** How a verified alternative relates to what each partner said. Deterministic, no inference. */
function fit(rec: Recommendation, state: DecisionState): { tone: "good" | "warn"; text: string }[] {
  const out: { tone: "good" | "warn"; text: string }[] = [];
  const q = (id: string) => state.questions.find((x) => x.id === id);
  const prefs = (id: string) => Object.entries(q(id)?.answers ?? {});
  const partner = (pid: string) => state.brief.partners.find((p) => p.id === pid)?.name ?? "";
  for (const c of rec.raw_changes) {
    if (c.path === "shared.property.purchase" && typeof q("purchase")?.value === "string" && String(c.value) > String(q("purchase")!.value)) {
      for (const [pid, a] of prefs("date_flex")) {
        if (a.value === "fixed") out.push({ tone: "warn", text: `${partner(pid)} said the date is essential` });
        if (a.value === "year") out.push({ tone: "good", text: `${partner(pid)} is open to waiting` });
      }
    }
    if (c.path === "shared.property.price" && Number(c.value) < Number(q("price")?.value)) {
      for (const [pid, a] of prefs("budget_flex")) {
        if (a.value === "trim") out.push({ tone: "warn", text: `${partner(pid)} would rather keep the budget` });
        if (a.value === "lower") out.push({ tone: "good", text: `${partner(pid)} would rather reduce the budget` });
      }
    }
    if (/^people\.[^.]+\.categories\./.test(c.path)) {
      for (const [pid, a] of [...prefs("budget_flex"), ...prefs("priority")]) {
        if (a.value === "trim") out.push({ tone: "good", text: `${partner(pid)} is open to trimming spending` });
        if (a.value === "lifestyle") out.push({ tone: "warn", text: `${partner(pid)} wants to keep your lifestyle` });
      }
    }
    if (c.path === "shared.household.rent" && Number(c.value) < Number(q("rent")?.value)) {
      for (const [pid, a] of prefs("rent_flex")) {
        if (a.value === "no") out.push({ tone: "warn", text: `${partner(pid)} sees the rent as fixed` });
        if (a.value === "yes") out.push({ tone: "good", text: `${partner(pid)} would look for something cheaper` });
      }
    }
  }
  return out.filter((x, i) => out.findIndex((y) => y.text === x.text) === i);
}

function Alternatives({ recs, state, onUse }: { recs: RecResponse; state: DecisionState; onUse: (changes: Change[]) => void }) {
  const list = recs.recommendations.slice(0, 3);
  return (
    <section aria-labelledby="alternatives">
      <h3 id="alternatives" className="text-[16px] font-semibold tracking-tight">Verified alternatives</h3>
      <p className="mt-0.5 text-[12.5px] text-muted">
        Converge re-simulated {recs.evaluated} variations of this plan. Each option below passes every hard check. They are
        not ranked by what you prefer and are not proven to be the best possible plan.
      </p>
      {list.length === 0 ? <p className="mt-3 rounded-2xl border border-line bg-white p-4 text-[13px] text-ink-2">{recs.message ?? "No single or paired change fixes this plan. Try changing the brief."}</p> : (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {list.map((r) => {
            const notes = fit(r, state);
            return (
              <article key={r.id} className="flex flex-col rounded-2xl border border-line bg-white p-4">
                <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{r.concession ? "Goal concession" : r.strategy_title}</div>
                <h4 className="mt-1 text-[14px] leading-snug font-semibold">{r.title}</h4>
                <ul className="mt-2 space-y-1 text-[12.5px]">
                  {r.changes.map((c) => (
                    <li key={c.path}><span className="text-muted">{c.owner_name ? `${c.owner_name} · ` : ""}{c.label}</span>
                      <span className="tnum ml-1 inline-flex items-center gap-1"><span className="text-subtle line-through">{c.previous_text}</span><ArrowRight size={11} className="text-subtle" /><b>{c.value_text}</b></span></li>
                  ))}
                </ul>
                {notes.length > 0 && <ul className="mt-2 space-y-0.5 text-[12px]">{notes.map((n) => <li key={n.text} className={n.tone === "good" ? "text-good" : "text-warn"}>{n.tone === "good" ? "Fits: " : "Conflicts: "}{n.text}</li>)}</ul>}
                <div className="mt-auto pt-3.5">
                  <Button size="sm" variant="secondary" onClick={() => onUse(r.raw_changes)}><Check size={14} /> Use in this plan</Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function DecisionReview({ state, onAdjust, onPropose, onRemove, onEdit }: {
  state: DecisionState; onAdjust: (changes: Change[]) => void; onPropose: () => Promise<void>; onRemove: () => Promise<void>; onEdit: () => void;
}) {
  const { stress, viewer, name, draft, setInboxOpen, setSourcesOpen, ws } = useStore();
  const [sim, setSim] = useState<{ key: string; data: SimResponse | null; error: string | null }>({ key: "", data: null, error: null });
  const [recs, setRecs] = useState<{ key: string; data: RecResponse | null }>({ key: "", data: null });
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify([state.changes, stress, ws?.versions.length]);
  const changes = useMemo(() => state.changes, [state.changes]);

  useEffect(() => {
    const ctrl = new AbortController();
    api.simulate(changes, ctrl.signal, stress)
      .then((data) => setSim({ key, data, error: null }))
      .catch((e) => { if ((e as Error).name !== "AbortError") setSim({ key, data: null, error: e instanceof Error ? e.message : String(e) }); });
    return () => ctrl.abort();
  }, [key, changes, stress]);

  const ev = sim.key === key ? sim.data?.evaluation : null;
  const needsRecs = !!ev && ev.status !== "on_track" && changes.length > 0;
  useEffect(() => {
    if (!needsRecs) return;
    const ctrl = new AbortController();
    api.recommendations(changes, ctrl.signal, stress)
      .then((data) => setRecs({ key, data }))
      .catch((e) => { if ((e as Error).name !== "AbortError") setRecs({ key, data: null }); });
    return () => ctrl.abort();
  }, [needsRecs, key, changes, stress]);

  const others = state.approvers.filter((a) => a !== viewer);
  const pending = state.proposal?.status === "pending";
  const unrelatedDraft = draft.filter((d) => !changes.some((c) => c.path === d.path)).length;

  if (sim.error && sim.key === key) return <p role="alert" className="rounded-2xl border border-line bg-white p-5 text-[13.5px] text-bad-strong">{sim.error}</p>;
  if (!ev || !sim.data) return (
    <div className="flex h-40 items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-[13.5px] text-muted">
      <Loader2 size={16} className="animate-spin" /> Simulating your plan…
    </div>
  );
  const base = sim.data.base ?? null;
  const v = verdict(ev);
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <StatusPill status={ev.status} size="sm" />
          <span>Preview · simulated on top of your agreed plan</span>
          <StressTag />
        </div>
        <h2 className="mt-2 text-[22px] leading-tight font-semibold tracking-tight">{v.title}</h2>
        <p className="mt-1.5 text-[14px] leading-6 text-muted">{v.detail}</p>
        {ev.issues.length > 1 && <ul className="mt-2 space-y-0.5 text-[12.5px]">
          {ev.issues.slice(1, 4).map((i) => <li key={i.id} className={i.severity === "hard" ? "text-bad-strong" : "text-warn"}>{i.title}</li>)}
        </ul>}
        <Explanation key={key} changes={changes} stress={stress} />
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        {ev.people.map((p) => <PartnerImpact key={p.id} p={p} before={base?.people.find((x) => x.id === p.id)} />)}
      </div>

      <DecisionFacts id={state.module.id} ev={ev} sim={sim.data} />

      <section aria-label="Projection" className="rounded-2xl border border-line bg-white px-2 pt-4 pb-3 sm:px-4">
        <div className="mb-1 px-3 sm:px-1"><ChartLegend names={ev.people.map((p) => p.name)} showBase={!!base} showFloor
          showBreak={ev.events.some((e) => e.kind === "career_break")} /></div>
        <CashChart current={ev} base={base} metric="cash" showFloors height={250} />
        <p className="px-3 pt-1 text-[11.5px] text-subtle sm:px-1">Dashed lines: your agreed plan today. Monthly cash under these assumptions, {monthLabel(ev.months[0])} – {monthLabel(ev.months[ev.months.length - 1])}.</p>
      </section>

      {needsRecs && (recs.key === key && recs.data ? <Alternatives recs={recs.data} state={state} onUse={onAdjust} /> : (
        <div className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-[13px] text-muted">
          <Loader2 size={15} className="animate-spin" /> Checking alternatives…
        </div>
      ))}

      <section className="rounded-2xl border border-line bg-page p-4 text-[12.5px] leading-5 text-ink-2">
        <div className="font-semibold text-ink">Assumptions and uncertainty</div>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {state.brief.uncertain.map((u) => <li key={u}>{u} (assumption)</li>)}
          {state.brief.limits.map((l) => <li key={l}>{l}</li>)}
          <li>A single deterministic projection, not a forecast. Real outcomes will differ.</li>
        </ul>
        <button type="button" onClick={() => setSourcesOpen(true)} className="mt-2 font-medium text-accent hover:underline">All assumptions & sources</button>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        {state.errors.length > 0 ? <p className="text-[13.5px] text-bad-strong">{state.errors[0]}</p>
          : changes.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13.5px] text-ink-2">{state.active ? "This matches your agreed plan." : "Nothing to propose yet."}</p>
              {state.active && <Button variant="ghost" size="sm" disabled={busy} onClick={async () => { setBusy(true); await onRemove(); setBusy(false); }}>Propose removing it from the plan</Button>}
            </div>
          ) : pending && !state.proposal?.outdated ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13.5px] text-ink-2">Proposed by {state.proposal!.author === viewer ? "you" : name(state.proposal!.author)}. Waiting for{" "}
                {Object.entries(state.proposal!.approvals).filter(([, s]) => s === "pending").map(([p]) => name(p)).join(" & ")}.
                Your agreed plan doesn&apos;t change until then.</p>
              <Button variant="secondary" size="sm" onClick={() => setInboxOpen(true)}>Open proposals</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-[13px] leading-5 text-muted">
                <p className="text-ink-2">{others.length ? `Nothing changes in your agreed plan until ${others.map(name).join(" & ")} approves.` : "This only changes your own plan."}</p>
                {pending && <p>This replaces the version you proposed earlier.</p>}
                {unrelatedDraft > 0 && <p>Your {unrelatedDraft} other unsaved change{unrelatedDraft > 1 ? "s are" : " is"} not included.</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" size="sm" onClick={onEdit}>Edit the brief</Button>
                <Button variant="primary" size="sm" disabled={busy} onClick={async () => { setBusy(true); await onPropose(); setBusy(false); }}>
                  <Send size={14} /> {others.length ? `Propose to ${others.map(name).join(" & ")}` : "Save to my plan"}
                </Button>
              </div>
            </div>
          )}
      </section>
    </div>
  );
}
