"use client";

import { ChevronRight, Home, Users } from "lucide-react";
import { useState } from "react";

import { CashChart, ChartLegend } from "./charts/CashChart";
import { Decisions } from "./Decisions";
import { Recommendations } from "./Recommendations";
import { Avatar, Segmented, Skeleton, clsx } from "./ui";
import { api, llmProviderLabel } from "@/lib/api";
import { chf, monthLabel, pct } from "@/lib/format";
import { mergeChanges } from "@/lib/plan";
import { useDisplayed, useStore } from "@/lib/store";
import type { Change, Evaluation, ExplainResponse, Issue } from "@/lib/types";

function headline(ev: Evaluation): { title: string; sub: string; issue: Issue | null } {
  const hard = ev.issues.find((i) => i.severity === "hard");
  const soft = ev.issues.find((i) => i.severity === "soft");
  const name = (id: string | null) => ev.people.find((p) => p.id === id)?.name ?? "";
  if (hard?.kind === "liquidity_floor") {
    const p = ev.people.find((x) => x.id === hard.person)!;
    return {
      title: `${name(hard.person)}’s savings fall below the safety buffer in ${monthLabel(hard.worst_month ?? hard.month)}.`,
      sub: `${chf(hard.amount_chf)} short at the lowest point, ${chf(p.min_cash)} against a minimum of ${chf(p.floor)}.`,
      issue: hard,
    };
  }
  if (hard?.kind === "affordability") {
    const a = ev.property?.affordability;
    return {
      title: "The home fails the affordability check.",
      sub: a?.ratio ? `Imputed housing costs would be ${pct(a.ratio, 1)} of your combined usual net income. This check uses a ${pct(a.max_ratio)} limit. A price up to ${chf(a.max_price)} would pass.` : hard.detail,
      issue: hard,
    };
  }
  if (soft) {
    return { title: soft.kind === "goal" ? `${soft.title}.` : `${soft.title}.`, sub: soft.detail, issue: soft };
  }
  const tight = [...ev.people].sort((a, b) => a.headroom / a.floor - b.headroom / b.floor)[0];
  return {
    title: "Your plan works for both of you.",
    sub: `Tightest moment: ${tight.name} in ${monthLabel(tight.min_cash_month)}, ${chf(tight.headroom)} above the safety buffer.`,
    issue: null,
  };
}

function Explanation({ changes }: { changes: Change[] }) {
  const [result, setResult] = useState<ExplainResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const explain = async () => {
    setBusy(true);
    setFailed(false);
    try {
      setResult(await api.explain(changes));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 border-t border-line pt-3 text-[13px]" aria-live="polite">
      {result ? (
        <>
          <p className="text-muted">{result.provider ? llmProviderLabel[result.provider] : "Engine summary"}</p>
          {result.notice && <p className="mt-1 text-warn">{result.notice}</p>}
          <p className="mt-1 text-ink-2">{result.text}</p>
        </>
      ) : (
        <>
          <button onClick={explain} disabled={busy} className="font-medium text-accent hover:underline disabled:opacity-60">
            {busy ? "Explaining…" : "Explain this result"}
          </button>
          {failed && <p className="mt-1 text-warn">Could not load the explanation.</p>}
        </>
      )}
    </div>
  );
}

function Why({ issue, others }: { issue: Issue; others: Issue[] }) {
  const { plan, ws, draft, preview } = useStore();
  const max = Math.max(1, ...issue.drivers.map((d) => d.amount_chf));
  const changes = plan && preview?.sim ? mergeChanges(draft, preview.changes, plan) : draft;
  return (
    <div className="fade-up mt-5 max-w-2xl rounded-2xl border border-line bg-white p-5">
      {issue.drivers.length > 0 && (
        <>
          <div className="mb-3 text-[13px] text-muted">What drives it, up to {monthLabel(issue.worst_month ?? issue.month)}</div>
          <div className="space-y-2.5">
            {issue.drivers.slice(0, 5).map((d) => (
              <div key={d.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 text-[13.5px]">
                <span className="truncate text-ink-2">{d.label}</span>
                <span className="tnum font-medium">{chf(d.amount_chf)}</span>
                <div className="col-span-2 h-1 rounded-full bg-page"><div className="h-1 rounded-full bg-ink/70" style={{ width: `${(d.amount_chf / max) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </>
      )}
      {others.length > 0 && (
        <div className="mt-4 border-t border-line pt-3 text-[13px] text-ink-2">
          Also: {others.map((o) => o.title).join(" · ")}
        </div>
      )}
      <Explanation key={JSON.stringify([ws?.versions[0], changes])} changes={changes} />
    </div>
  );
}

function Hero({ ev, base, hasDraft }: { ev: Evaluation; base: Evaluation | null; hasDraft: boolean }) {
  const [why, setWhy] = useState(false);
  const { preview } = useStore();
  const h = headline(ev);
  const dot = ev.status === "on_track" ? "bg-good" : ev.status === "attention" ? "bg-warn" : "bg-bad-strong";
  const deltas = hasDraft && base ? ev.people.map((p, i) => ({ p, b: base.people[i] })).filter(({ p, b }) => Math.abs(p.min_cash - b.min_cash) >= 1) : [];
  return (
    <section className="pt-6 pb-2 sm:pt-10">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <span className={clsx("h-2 w-2 rounded-full", dot)} />
        {preview ? <span className="font-medium text-brand">Preview — nothing is saved</span> : hasDraft ? <span className="font-medium text-accent">Your draft</span> : <span>Agreed plan</span>}
        <span>· {monthLabel(ev.months[0])} – {monthLabel(ev.months[ev.months.length - 1])}</span>
      </div>
      <h1 className="mt-3 max-w-3xl text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] text-ink sm:text-[36px]">{h.title}</h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-6 text-muted">
        {h.sub}{" "}
        {h.issue && <button onClick={() => setWhy(!why)} className="font-medium text-accent hover:underline">{why ? "Hide" : "Why?"}</button>}
      </p>
      {why && h.issue && <Why issue={h.issue} others={ev.issues.filter((i) => i.id !== h.issue!.id)} />}
      {deltas.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {deltas.map(({ p, b }) => {
            const d = p.min_cash - b.min_cash;
            const tone = p.breach && !b.breach ? "bg-bad-soft text-bad-strong" : d > 0 ? "bg-good-soft text-good" : "bg-white text-ink-2 ring-1 ring-line";
            return (
              <span key={p.id} className={clsx("tnum inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px]", tone)}>
                {p.name}&apos;s lowest cash <b>{chf(p.min_cash, { compact: true })}</b>
                <span className="opacity-80">({chf(d, { sign: true, compact: Math.abs(d) >= 10_000 })})</span>
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PersonTile({ ev, i, base }: { ev: Evaluation; i: number; base: Evaluation | null }) {
  const { openSheet, plan, viewer } = useStore();
  const p = ev.people[i];
  const person = plan?.people[i];
  const goalsMet = p.goals.filter((g) => g.met || !g.in_horizon).length;
  const changed = base && Math.abs(base.people[i].min_cash - p.min_cash) >= 1;
  return (
    <button onClick={() => openSheet({ kind: "person", id: p.id })} className="group flex flex-col rounded-2xl border border-line bg-white p-5 text-left transition-shadow hover:shadow-[0_6px_24px_rgb(15_23_42/0.07)]">
      <div className="flex w-full items-center justify-between">
        <span className="flex items-center gap-2.5">
          <Avatar name={p.name} index={i} size={30} />
          <span className="text-[15px] font-semibold">{p.name}{p.id === viewer && <span className="ml-1.5 text-[12px] font-normal text-muted">you</span>}</span>
        </span>
        <ChevronRight size={18} className="text-subtle transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="mt-5 text-[12.5px] text-muted">Cash today</div>
      <div className="tnum text-[26px] font-semibold tracking-tight">{chf(person?.opening_cash ?? p.start_cash, { compact: true })}</div>
      <div className="mt-4 space-y-1.5 text-[13px]">
        <div className="flex justify-between gap-2">
          <span className="text-muted">Lowest point</span>
          <span className={clsx("tnum font-medium", p.breach ? "text-bad-strong" : changed ? "text-accent" : "text-ink")}>
            {person && p.min_cash >= person.opening_cash ? "Never below today" : `${chf(p.min_cash, { compact: true })} · ${monthLabel(p.min_cash_month, true)}`}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted">Goals</span>
          <span className={clsx("font-medium", goalsMet < p.goals.length ? "text-warn" : "text-ink")}>{p.goals.length ? `${goalsMet} of ${p.goals.length} on track` : "None"}</span>
        </div>
      </div>
    </button>
  );
}

function SharedTile({ ev }: { ev: Evaluation }) {
  const { openSheet, draftPlan } = useStore();
  if (!draftPlan) return null;
  const pr = ev.property;
  const hh = draftPlan.shared.household;
  const [a, b] = ev.people;
  return (
    <button onClick={() => openSheet({ kind: "shared" })} className="group flex flex-col rounded-2xl border border-dashed border-line-strong bg-page/60 p-5 text-left transition-colors hover:bg-white">
      <div className="flex w-full items-center justify-between">
        <span className="flex items-center gap-2.5">
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white ring-1 ring-line">{pr ? <Home size={15} /> : <Users size={15} />}</span>
          <span className="text-[15px] font-semibold">Together</span>
        </span>
        <ChevronRight size={18} className="text-subtle transition-transform group-hover:translate-x-0.5" />
      </div>
      {pr ? (
        <>
          <div className="mt-5 text-[12.5px] text-muted">Home · {monthLabel(pr.purchase)}</div>
          <div className="tnum text-[26px] font-semibold tracking-tight">{chf(pr.price, { compact: true })}</div>
          <div className="mt-4 text-[13px]">
            <div className="mb-1.5 flex justify-between text-muted"><span>Deposit</span><span className="tnum">{a.name} {pct(pr.ownership[0])} · {b.name} {pct(pr.ownership[1])}</span></div>
            <div className="flex h-1.5 overflow-hidden rounded-full">
              <div className="bg-p0" style={{ width: pct(pr.ownership[0]) }} />
              <div className="w-0.5 bg-white" />
              <div className="bg-p1" style={{ width: pct(pr.ownership[1]) }} />
            </div>
          </div>
        </>
      ) : hh.enabled ? (
        <>
          <div className="mt-5 text-[12.5px] text-muted">Living together from {monthLabel(hh.move_in)}</div>
          <div className="tnum text-[26px] font-semibold tracking-tight">{chf(hh.rent)}<span className="text-[14px] font-normal text-muted">/mo rent</span></div>
        </>
      ) : (
        <>
          <div className="mt-5 text-[15px] font-medium text-ink">Nothing shared yet</div>
          <p className="mt-1 text-[13px] leading-5 text-muted">Plan a home or moving in together. Each of you keeps your own accounts.</p>
        </>
      )}
    </button>
  );
}

export function PlanView() {
  const { ws, draft, preview } = useStore();
  const { current, base } = useDisplayed();
  const [metric, setMetric] = useState<"cash" | "net_worth">("cash");
  if (!current || !ws) {
    return (
      <div className="space-y-6 pt-10">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-[340px]" />
      </div>
    );
  }
  const hasDraft = draft.length > 0 || !!preview;
  const cmp = hasDraft ? base : null;
  return (
    <div className="space-y-10">
      <div>
        <Hero ev={current} base={cmp} hasDraft={hasDraft} />
        <div className="mt-6"><Decisions /></div>
      </div>

      <section aria-label="Projection" className="rounded-2xl border border-line bg-white px-2 pt-4 pb-4 sm:px-5 sm:pt-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3 px-3 sm:px-1">
          <ChartLegend names={current.people.map((p) => p.name)} showBase={hasDraft} showFloor={metric === "cash"} showBreak={current.events.some((e) => e.kind === "career_break")} />
          <Segmented size="sm" ariaLabel="Metric" value={metric} onChange={setMetric} options={[{ value: "cash", label: "Cash" }, { value: "net_worth", label: "Net worth" }]} />
        </div>
        <CashChart current={current} base={cmp} metric={metric} showFloors={metric === "cash"} height={320} />
      </section>

      <Recommendations />

      <section aria-label="Partners" className="grid gap-4 md:grid-cols-3">
        <PersonTile ev={current} i={0} base={cmp} />
        <SharedTile ev={current} />
        <PersonTile ev={current} i={1} base={cmp} />
      </section>
    </div>
  );
}
