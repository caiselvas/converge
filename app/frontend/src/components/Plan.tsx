"use client";

import Link from "next/link";
import { useState } from "react";

import { CashChart, ChartLegend } from "./charts/CashChart";
import { Decisions, StressTag } from "./Decisions";
import { Recommendations, useRecommendationList } from "./Recommendations";
import { Segmented, Skeleton, clsx } from "./ui";
import { api, llmProviderLabel } from "@/lib/api";
import { chf, monthLabel, pct } from "@/lib/format";
import { mergeChanges } from "@/lib/plan";
import { scopedHref, scopedIssues, useDisplayed, useStore } from "@/lib/store";
import type { Change, Evaluation, ExplainResponse, GoalStatus, Issue, Stress } from "@/lib/types";

function goalHeadline(goal: GoalStatus) {
  return goal.reached_month
    ? `${goal.name} slips to ${monthLabel(goal.reached_month)}.`
    : `${goal.name} is ${chf(goal.shortfall_chf)} short.`;
}

function missedGoals(ev: Evaluation, personId?: string) {
  return ev.people.filter((p) => !personId || p.id === personId)
    .flatMap((p) => p.goals.filter((g) => g.in_horizon && !g.met).map((g) => ({ personId: p.id, goal: g })));
}

function headline(ev: Evaluation, personId?: string): { title: string; sub: string; issue: Issue | null } {
  const issues = scopedIssues(ev, personId);
  const hard = issues.find((i) => i.severity === "hard");
  const soft = issues.find((i) => i.severity === "soft");
  const person = ev.people.find((p) => p.id === personId);
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
    const missed = missedGoals(ev, personId).find(({ personId: id, goal }) => soft.id === `goal:${id}:${goal.id}`);
    return { title: missed ? goalHeadline(missed.goal) : `${soft.title}.`, sub: soft.detail, issue: soft };
  }
  const tight = person ?? [...ev.people].sort((a, b) => a.headroom / a.floor - b.headroom / b.floor)[0];
  return {
    title: person ? `${person.name}’s plan is on track.` : "Your plan works for both of you.",
    sub: `Tightest moment: ${tight.name} in ${monthLabel(tight.min_cash_month)}, ${chf(tight.headroom)} above the safety buffer.`,
    issue: null,
  };
}

function Explanation({ changes, stress }: { changes: Change[]; stress: Stress }) {
  const [result, setResult] = useState<ExplainResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const explain = async () => {
    setBusy(true);
    setFailed(false);
    try {
      setResult(await api.explain(changes, stress));
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
  const { plan, ws, draft, preview, stress, scopedPerson } = useStore();
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
      {!scopedPerson && <Explanation key={JSON.stringify([ws?.versions[0], changes, stress])} changes={changes} stress={stress} />}
    </div>
  );
}

function StatusDot({ issues }: { issues: Issue[] }) {
  const tone = issues.some((i) => i.severity === "hard") ? "bg-bad-strong" : issues.length ? "bg-warn" : "bg-good";
  return <span className={clsx("h-2 w-2 shrink-0 rounded-full", tone)} />;
}

function CashDeltas({ ev, base, personId, compact }: { ev: Evaluation; base: Evaluation; personId?: string; compact?: boolean }) {
  return (
    <div aria-label="Lowest cash changes" className={clsx("flex flex-wrap gap-1.5", compact ? "mt-1" : "mt-4")}>
      {ev.people.filter((p) => !personId || p.id === personId).map((p) => {
        const before = base.people.find((partner) => partner.id === p.id);
        if (!before) return null;
        const delta = p.min_cash - before.min_cash;
        const tone = p.breach && !before.breach ? "bg-bad-soft text-bad-strong" : delta >= 1 ? "bg-good-soft text-good" : "bg-page text-ink-2";
        return (
          <span key={p.id} className={clsx("tnum inline-flex items-center gap-1.5 rounded-full", compact ? "px-2 py-0.5 text-[11.5px]" : "px-3 py-1.5 text-[13px]", tone)}>
            {p.name}{compact ? " low" : "’s lowest cash"} <b>{chf(p.min_cash, { compact: true })}</b>
            <span className="opacity-80">({chf(delta, { sign: true, compact: Math.abs(delta) >= 10_000 })})</span>
          </span>
        );
      })}
    </div>
  );
}

export function OutcomeStrip() {
  const { scope, scopedPerson, draft, preview, simError } = useStore();
  const { current, base } = useDisplayed();
  if (!current) return null;
  const personId = scopedPerson?.id;
  return (
    <div className="border-b border-line bg-page">
      <div className="mx-auto flex max-w-[1120px] items-center gap-2 px-4 md:px-5">
        <Link href={scopedHref("/plan", scope)} aria-label={`View plan: ${headline(current, personId).title}`} className="block min-w-0 flex-1 py-1.5 hover:text-accent">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <StatusDot issues={scopedIssues(current, personId)} />
            <span className="truncate">{headline(current, personId).title}</span>
          </div>
          {(draft.length > 0 || preview) && base && <CashDeltas ev={current} base={base} personId={personId} compact />}
          {simError && <p className="mt-1 truncate text-[12px] text-bad-strong">{simError}</p>}
        </Link>
        <StressTag />
      </div>
    </div>
  );
}

function Hero({ ev, base }: { ev: Evaluation; base: Evaluation | null }) {
  const [why, setWhy] = useState(false);
  const { preview, scopedPerson, draft, ws, viewer, name, setInboxOpen } = useStore();
  const { list } = useRecommendationList();
  const personId = scopedPerson?.id;
  const issues = scopedIssues(ev, personId);
  const h = headline(ev, personId);
  const hasConflict = issues.some((i) => i.severity === "hard");
  const pending = ws?.proposals.find((p) => p.status === "pending" && p.approvals[viewer] === "pending");
  const goalRisks = missedGoals(ev, personId).filter(({ personId: id, goal }) => h.issue?.id !== `goal:${id}:${goal.id}`);
  return (
    <section className="pt-5 pb-1 sm:pt-7">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <StatusDot issues={issues} />
        {preview ? <span className="font-medium text-brand">Preview</span> : draft.length ? <span className="font-medium text-accent">Your draft</span> : <span>Agreed plan</span>}
        <span>· {monthLabel(ev.months[0])} – {monthLabel(ev.months[ev.months.length - 1])}</span>
        <StressTag />
      </div>
      <h1 className="mt-2 max-w-3xl text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] text-ink sm:text-[36px]">{h.title}</h1>
      <p className="mt-2 max-w-2xl text-[15px] leading-6 text-muted">
        {h.sub}{" "}
        {h.issue && <button onClick={() => setWhy(!why)} className="font-medium text-accent hover:underline">{why ? "Hide" : "Why?"}</button>}
      </p>
      {hasConflict && list.length > 0 && <a href="#fixes" className="mt-1 inline-block text-[13px] font-semibold text-accent hover:underline"
        onClick={(event) => {
          const target = document.getElementById("fixes");
          if (!target) return;
          event.preventDefault();
          target.focus({ preventScroll: true });
          target.scrollIntoView({ block: "start" });
        }}>See {list.length} {list.length === 1 ? "way" : "ways"} to fix this</a>}
      {goalRisks.map(({ personId: id, goal }) => <p key={`${id}:${goal.id}`} className="mt-1 text-[13px] text-warn">{goalHeadline(goal)}</p>)}
      {pending && <button type="button" onClick={() => setInboxOpen(true)} className="mt-2 block max-w-full truncate text-left text-[13px] text-muted hover:text-ink">
        {name(pending.author)} proposed {pending.title} <span className="font-medium text-accent">· Review</span>
      </button>}
      {why && h.issue && <Why issue={h.issue} others={issues.filter((i) => i.id !== h.issue?.id)} />}
      {base && <CashDeltas ev={ev} base={base} personId={personId} />}
    </section>
  );
}

export function PlanView() {
  const { draft, preview, scopedPerson, idx, simError, stress } = useStore();
  const { current, base } = useDisplayed();
  const [metric, setMetric] = useState<"cash" | "net_worth">("cash");
  if (!current) return (
    <div className="space-y-6 pt-10">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-[340px]" />
    </div>
  );
  const only = scopedPerson ? idx(scopedPerson.id) : undefined;
  const editing = draft.length > 0 || !!preview;
  const cmp = editing || Object.keys(stress).length ? base : null;
  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <Hero ev={current} base={editing ? base : null} />
        {simError && <p role="alert" className="mt-2 text-[13px] text-bad-strong">{simError}</p>}
        <div className="mt-3"><Decisions /></div>
      </div>
      <Recommendations />
      <section aria-label="Projection" className="rounded-2xl border border-line bg-white px-2 pt-4 pb-4 sm:px-5 sm:pt-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3 px-3 sm:px-1">
          <ChartLegend names={current.people.map((p) => p.name)} only={only} showBase={!!cmp} showFloor={metric === "cash"}
            showBreak={current.events.some((e) => e.kind === "career_break" && (!scopedPerson || e.person === scopedPerson.id))} />
          <Segmented size="sm" ariaLabel="Metric" value={metric} onChange={setMetric} options={[{ value: "cash", label: "Cash" }, { value: "net_worth", label: "Net worth" }]} />
        </div>
        <CashChart current={current} base={cmp} only={only} metric={metric} showFloors={metric === "cash"} height={320} />
      </section>
    </div>
  );
}
