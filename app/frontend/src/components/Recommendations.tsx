"use client";

import { ArrowRight, Check, ChevronDown, Eye, EyeOff, Loader2, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { useState } from "react";

import { chf, monthLabel } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Recommendation } from "@/lib/types";
import { ChangeRow } from "./DraftBar";
import { Avatar, Badge, Button, Card, clsx } from "./ui";

function HeadroomBar({ before, after, floor }: { before: number; after: number; floor: number }) {
  // Visual: cushion above the minimum, before vs after (negative = below minimum).
  const scale = Math.max(Math.abs(before), Math.abs(after), floor * 0.5, 1);
  const w = (v: number) => `${Math.min(100, (Math.abs(v) / scale) * 50)}%`;
  return (
    <div className="relative h-2 w-full rounded-full bg-page ring-1 ring-line/70" aria-hidden>
      <div className="absolute top-[-3px] left-1/2 h-[14px] w-px bg-subtle" />
      {[before, after].map((v, k) => (
        <div
          key={k}
          className={clsx("absolute top-0 h-full rounded-full", k === 0 ? "opacity-35" : "", v < 0 ? "bg-bad-strong" : "bg-good")}
          style={v < 0 ? { right: "50%", width: w(v), top: k === 0 ? 0 : 0 } : { left: "50%", width: w(v) }}
        />
      ))}
    </div>
  );
}

export function RecCard({ rec, rank }: { rec: Recommendation; rank: number }) {
  const { preview, startPreview, stopPreview, addChanges, dismissRec, name, idx, toast } = useStore();
  const [why, setWhy] = useState(false);
  const previewing = preview?.label === rec.title;
  return (
    <Card className={clsx("flex flex-col overflow-hidden transition-shadow", previewing && "ring-2 ring-brand")}>
      <div className="border-b border-line px-5 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <Badge tone={rank === 0 ? "info" : "neutral"}>
            {rank === 0 && <Sparkles size={11} />}
            {rec.strategy_title}
          </Badge>
          {rec.verified && (
            <span className="inline-flex items-center gap-1 text-[11.5px] text-good">
              <ShieldCheck size={13} /> Verified by simulation
            </span>
          )}
        </div>
        <h4 className="mt-2 text-[15px] leading-snug font-semibold text-ink">{rec.title}</h4>
        <p className="mt-0.5 text-[12.5px] text-muted">{rec.strategy_blurb}</p>
      </div>

      <div className="divide-y divide-line px-5">
        {rec.changes.map((c) => <ChangeRow key={c.path} c={c} />)}
      </div>

      <div className="mt-1 space-y-3 bg-page/60 px-5 py-4">
        {rec.people.map((p, i) => (
          <div key={p.id}>
            <div className="mb-1.5 flex items-center justify-between gap-2 text-[12.5px]">
              <span className="flex items-center gap-1.5 font-medium text-ink">
                <Avatar name={p.name} index={i} size={18} /> {p.name}
              </span>
              <span className="tnum text-muted">
                cushion{" "}
                <span className={p.headroom[0] < 0 ? "text-bad-strong" : ""}>{chf(p.headroom[0], { compact: true })}</span>
                <ArrowRight size={11} className="mx-1 inline text-subtle" />
                <b className={p.headroom[1] < 0 ? "text-bad-strong" : "text-ink"}>{chf(p.headroom[1], { compact: true })}</b>
              </span>
            </div>
            <HeadroomBar before={p.headroom[0]} after={p.headroom[1]} floor={p.floor} />
          </div>
        ))}
        {rec.shared && (
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="text-muted">Home purchase</span>
            <span className="tnum font-medium text-ink">
              {rec.shared.purchase[0] !== rec.shared.purchase[1] ? (
                <>{monthLabel(rec.shared.purchase[0], true)} <ArrowRight size={11} className="mx-0.5 inline text-subtle" /> {monthLabel(rec.shared.purchase[1], true)}</>
              ) : monthLabel(rec.shared.purchase[1])}
              {rec.shared.on_time[1] ? <span className="ml-1.5 text-good">on time</span> : <span className="ml-1.5 text-warn">later than hoped</span>}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between text-[12.5px]">
          <span className="text-muted">Tightest runway</span>
          <span className="tnum font-medium text-ink">
            {rec.optionality.lowest_runway_months[0].toFixed(1)} <ArrowRight size={11} className="mx-0.5 inline text-subtle" /> {rec.optionality.lowest_runway_months[1].toFixed(1)} months
          </span>
        </div>
      </div>

      <div className="px-5 pt-3 pb-1">
        <button onClick={() => setWhy(!why)} aria-expanded={why} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
          Why this works
          <ChevronDown size={13} className={clsx("transition-transform", why && "rotate-180")} />
        </button>
        {why && (
          <div className="fade-up mt-2 space-y-2.5 text-[12.5px] leading-5 text-ink-2">
            <p>{rec.why}</p>
            {rec.resolves.length > 0 && (
              <div>
                <div className="font-medium text-ink">Resolves</div>
                <ul className="mt-0.5 space-y-0.5">{rec.resolves.map((r) => <li key={r} className="flex gap-1.5"><Check size={13} className="mt-1 shrink-0 text-good" />{r}</li>)}</ul>
              </div>
            )}
            {(rec.remaining.length > 0 || rec.introduces.length > 0) && (
              <div>
                <div className="font-medium text-ink">Still open</div>
                <ul className="mt-0.5 space-y-0.5">{[...rec.remaining, ...rec.introduces].map((r) => <li key={r} className="flex gap-1.5"><X size={13} className="mt-1 shrink-0 text-warn" />{r}</li>)}</ul>
              </div>
            )}
            <div>
              <div className="font-medium text-ink">Trade-offs</div>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4">{rec.tradeoffs.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
            <p className="text-[11.5px] text-muted">{rec.assumptions.join(" ")}</p>
          </div>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 px-5 pt-3 pb-4">
        <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
          Needs
          <span className="flex -space-x-1">{rec.approvers.map((a) => <Avatar key={a} name={name(a)} index={idx(a)} size={18} ring />)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" aria-label="Dismiss suggestion" onClick={() => { if (previewing) stopPreview(); dismissRec(rec.id); }}>
            <X size={14} />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => (previewing ? stopPreview() : startPreview(rec.title, rec.raw_changes))}>
            {previewing ? <EyeOff size={14} /> : <Eye size={14} />} {previewing ? "End preview" : "Preview"}
          </Button>
          <Button size="sm" variant="primary" onClick={() => { addChanges(rec.raw_changes); toast("Added to your draft — review and propose when ready", "info"); }}>
            <Check size={14} /> Accept
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function Recommendations() {
  const { recs, recsLoading, dismissed, sim } = useStore();
  const status = sim?.evaluation.status;
  if (status === "on_track") return null;
  const list = recs?.recommendations.filter((r) => !dismissed.includes(r.id)) ?? [];
  return (
    <section aria-labelledby="recs-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="recs-title" className="text-[17px] font-semibold tracking-tight">Ways to make it work</h2>
          <p className="text-[13px] text-muted">Searched by the planning engine and re-simulated month by month. No numbers come from a language model.</p>
        </div>
        {recs && !recsLoading && <span className="text-[12px] text-subtle">{recs.evaluated} alternatives evaluated</span>}
      </div>
      {recsLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((k) => (
            <Card key={k} className="flex h-[300px] flex-col items-center justify-center gap-2 text-[13px] text-muted">
              {k === 1 ? <><Loader2 className="animate-spin" size={18} /> Searching for feasible plans…</> : <Search size={18} className="pulse-soft text-subtle" />}
            </Card>
          ))}
        </div>
      ) : list.length ? (
        <div className="grid items-stretch gap-4 md:grid-cols-3">
          {list.map((r, i) => <RecCard key={r.id} rec={r} rank={i} />)}
        </div>
      ) : recs?.message ? (
        <Card className="p-5 text-[13px] leading-6 text-ink-2">
          <div className="mb-1 font-semibold text-ink">No feasible adjustment found</div>
          {recs.message}
        </Card>
      ) : recs && recs.recommendations.length ? (
        <Card className="p-5 text-[13px] text-muted">All suggestions dismissed. Change the plan to get new ones.</Card>
      ) : null}
    </section>
  );
}
