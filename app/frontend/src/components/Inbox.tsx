"use client";

import { ArrowRight, Check, Clock, History, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { chf } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Evaluation, Proposal } from "@/lib/types";
import { ChangeRow } from "./DraftBar";
import { Avatar, Badge, Button, Card, Delta, Skeleton, StatusPill, clsx } from "./ui";

function Impact({ id }: { id: string }) {
  const [data, setData] = useState<{ base: Evaluation; evaluation: Evaluation } | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    api.preview(id).then((d) => setData(d as never)).catch(() => setErr(true));
  }, [id]);
  if (err) return <p className="text-[12px] text-muted">Impact unavailable — the plan changed since this was proposed.</p>;
  if (!data) return <Skeleton className="h-20" />;
  const { base, evaluation: ev } = data;
  return (
    <div className="rounded-xl bg-page p-3 ring-1 ring-line">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] text-muted">
        Plan status <StatusPill status={base.status} size="sm" /> <ArrowRight size={12} /> <StatusPill status={ev.status} size="sm" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {ev.people.map((p, i) => (
          <div key={p.id} className="text-[12.5px]">
            <div className="flex items-center gap-1.5 font-medium"><Avatar name={p.name} index={i} size={16} />{p.name}</div>
            <div className="mt-1 text-muted">Lowest cash</div>
            <div className="flex items-baseline gap-1.5">
              <span className={clsx("tnum font-semibold", p.breach ? "text-bad-strong" : "text-ink")}>{chf(p.min_cash, { compact: true })}</span>
              <Delta before={base.people[i].min_cash} after={p.min_cash} />
            </div>
          </div>
        ))}
      </div>
      {ev.issues.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[12px]">
          {ev.issues.map((x) => <li key={x.id} className={x.severity === "hard" ? "text-bad-strong" : "text-warn"}>• {x.title}</li>)}
        </ul>
      )}
    </div>
  );
}

function ProposalCard({ p, actionable }: { p: Proposal; actionable: boolean }) {
  const { name, idx, decide, viewer } = useStore();
  const [busy, setBusy] = useState(false);
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Avatar name={name(p.author)} index={idx(p.author)} size={28} />
          <div className="min-w-0">
            <div className="text-[13.5px] leading-snug font-semibold">{p.title}</div>
            <div className="text-[12px] text-muted">Proposed by {p.author === viewer ? "you" : name(p.author)} · {new Date(p.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</div>
          </div>
        </div>
        {p.kind === "recommendation" && <Badge tone="info">Suggested by engine</Badge>}
      </div>
      <div className="mt-2 divide-y divide-line">{p.described.map((c) => <ChangeRow key={c.path} c={c} />)}</div>
      {p.status === "pending" && <div className="mt-2"><Impact id={p.id} /></div>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          {Object.entries(p.approvals).map(([pid, st]) => (
            <span key={pid} className="flex items-center gap-1">
              <Avatar name={name(pid)} index={idx(pid)} size={16} />
              {st === "approved" ? <Check size={13} className="text-good" /> : st === "rejected" ? <X size={13} className="text-bad-strong" /> : <Clock size={13} className="text-subtle" />}
              <span className="text-muted">{st}</span>
            </span>
          ))}
        </div>
        {actionable && (
          <div className="flex gap-2">
            <Button size="sm" variant="danger" disabled={busy} onClick={async () => { setBusy(true); await decide(p.id, false); setBusy(false); }}>Decline</Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={async () => { setBusy(true); await decide(p.id, true); setBusy(false); }}><Check size={14} /> Approve</Button>
          </div>
        )}
        {!actionable && p.status === "pending" && p.author === viewer && (
          <Button size="sm" variant="ghost" onClick={() => decide(p.id, false)}>Withdraw</Button>
        )}
        {p.status !== "pending" && <Badge tone={p.status === "applied" ? "good" : p.status === "rejected" ? "bad" : "warn"}>{p.status}</Badge>}
      </div>
      {p.error && <p className="mt-2 text-[12px] text-bad-strong">{p.error}</p>}
    </Card>
  );
}

export function Inbox() {
  const { ws, viewer, name, restore } = useStore();
  if (!ws) return null;
  const pending = ws.proposals.filter((p) => p.status === "pending");
  const mine = pending.filter((p) => p.approvals[viewer] === "pending");
  const others = pending.filter((p) => p.approvals[viewer] !== "pending");
  const done = ws.proposals.filter((p) => p.status !== "pending").slice(0, 12);
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Waiting for you</h3>
        {mine.length ? <div className="space-y-3">{mine.map((p) => <ProposalCard key={p.id} p={p} actionable />)}</div> : <p className="text-[13px] text-muted">Nothing needs your approval right now.</p>}
      </section>
      {others.length > 0 && (
        <section>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Waiting for {ws.people.filter((p) => p.id !== viewer).map((p) => name(p.id)).join(" & ")}</h3>
          <div className="space-y-3">{others.map((p) => <ProposalCard key={p.id} p={p} actionable={false} />)}</div>
        </section>
      )}
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted"><History size={14} /> Plan versions</h3>
        <Card className="divide-y divide-line">
          {[...ws.versions].reverse().map((v, k) => (
            <div key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium">{v.title}</div>
                <div className="text-[11.5px] text-muted">v{v.id}{v.author ? ` · ${name(v.author)}` : ""} · {new Date(v.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</div>
              </div>
              {k === 0 ? <Badge tone="good">Current</Badge> : (
                <Button size="sm" variant="ghost" onClick={() => restore(v.id)}><RotateCcw size={13} /> Return to this</Button>
              )}
            </div>
          ))}
        </Card>
        <p className="mt-2 text-[11.5px] text-muted">Returning to an earlier version is itself a proposal that both partners approve.</p>
      </section>
      {done.length > 0 && (
        <section>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Decided</h3>
          <div className="space-y-3">{done.map((p) => <ProposalCard key={p.id} p={p} actionable={false} />)}</div>
        </section>
      )}
    </div>
  );
}
