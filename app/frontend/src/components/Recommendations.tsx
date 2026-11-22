"use client";

import { ArrowRight, Check, Eye, EyeOff, Loader2, X } from "lucide-react";
import { useState } from "react";

import { chf, monthLabel } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Recommendation } from "@/lib/types";
import { Avatar, Button, clsx } from "./ui";

function Cushion({ v }: { v: number }) {
  return <span className={clsx("tnum", v < 0 ? "text-bad-strong" : "text-ink")}>{chf(v, { compact: true })}</span>;
}

function RecCard({ rec }: { rec: Recommendation }) {
  const { preview, startPreview, stopPreview, addChanges, dismissRec, toast, name, idx } = useStore();
  const [why, setWhy] = useState(false);
  const previewing = preview?.label === rec.title;
  const affected = rec.people.filter((p) => Math.abs(p.headroom[1] - p.headroom[0]) >= 1);
  const delay = rec.shared && rec.shared.purchase[0] !== rec.shared.purchase[1];
  return (
    <article className={clsx("flex flex-col rounded-2xl border bg-white p-5 transition-shadow", previewing ? "border-brand ring-2 ring-brand/20" : "border-line")}>
      <div className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted">{rec.strategy_title}</div>
      <h3 className="mt-1.5 text-[16px] leading-snug font-semibold text-ink">{rec.title}</h3>

      <ul className="mt-4 space-y-2">
        {rec.changes.map((c) => (
          <li key={c.path} className="text-[13px]">
            <div className="text-muted">{c.owner_name ? `${c.owner_name} · ` : ""}{c.label}</div>
            <div className="tnum mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="text-subtle line-through">{c.previous_text}</span>
              <ArrowRight size={12} className="text-subtle" />
              <span className="font-semibold text-ink">{c.value_text}</span>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 space-y-1.5 border-t border-line pt-4 text-[13px]">
        {affected.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-ink-2"><Avatar name={p.name} index={idx(p.id)} size={18} />{p.name}&apos;s cushion</span>
            <span className="flex items-center gap-1.5"><Cushion v={p.headroom[0]} /><ArrowRight size={12} className="text-subtle" /><b><Cushion v={p.headroom[1]} /></b></span>
          </div>
        ))}
        {rec.shared && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-2">Home</span>
            <span className={clsx("tnum", delay ? "text-warn" : "text-muted")}>{delay ? `${monthLabel(rec.shared.purchase[1])}` : `${monthLabel(rec.shared.purchase[1])}, on time`}</span>
          </div>
        )}
      </div>

      {why && (
        <div className="fade-up mt-4 space-y-2 rounded-xl bg-page p-3.5 text-[12.5px] leading-5 text-ink-2">
          <p>{rec.why}</p>
          {rec.tradeoffs.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-muted">{rec.tradeoffs.map((t) => <li key={t}>{t}</li>)}</ul>}
          {rec.introduces.length > 0 && <p className="text-warn">Creates: {rec.introduces.join("; ")}</p>}
          <p className="text-[11.5px] text-muted">Needs approval from {rec.approvers.map(name).join(" & ")}. Verified by full re-simulation.</p>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-5">
        <button onClick={() => setWhy(!why)} className="text-[13px] font-medium text-accent hover:underline">{why ? "Less" : "Why?"}</button>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" aria-label="Dismiss" onClick={() => { if (previewing) stopPreview(); dismissRec(rec.id); }}><X size={15} /></Button>
          <Button size="sm" variant="secondary" onClick={() => (previewing ? stopPreview() : startPreview(rec.title, rec.raw_changes))}>
            {previewing ? <EyeOff size={14} /> : <Eye size={14} />} {previewing ? "Stop" : "Preview"}
          </Button>
          <Button size="sm" variant="primary" onClick={() => { stopPreview(); addChanges(rec.raw_changes); toast("Added to your draft", "info"); }}>
            <Check size={14} /> Accept
          </Button>
        </div>
      </div>
    </article>
  );
}

export function Recommendations() {
  const { recs, recsLoading, dismissed, sim } = useStore();
  if (!sim || sim.evaluation.status === "on_track") return null;
  const list = recs?.recommendations.filter((r) => !dismissed.includes(r.id)) ?? [];
  return (
    <section aria-labelledby="fixes" className="fade-up">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="fixes" className="text-[20px] font-semibold tracking-tight">Ways to make it work</h2>
        {recs && !recsLoading && recs.evaluated > 0 && <span className="text-[12.5px] text-muted">{recs.evaluated} options simulated · only verified ones shown</span>}
      </div>
      {recsLoading ? (
        <div className="flex h-40 items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-[13.5px] text-muted">
          <Loader2 size={16} className="animate-spin" /> Simulating alternatives…
        </div>
      ) : list.length ? (
        <div className="grid items-stretch gap-4 md:grid-cols-3">{list.map((r) => <RecCard key={r.id} rec={r} />)}</div>
      ) : recs?.message ? (
        <p className="rounded-2xl border border-line bg-white p-5 text-[13.5px] leading-6 text-ink-2">{recs.message}</p>
      ) : null}
    </section>
  );
}
