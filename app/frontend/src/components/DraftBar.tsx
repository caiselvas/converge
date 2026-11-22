"use client";

import * as Popover from "@radix-ui/react-popover";
import { ArrowRight, Eye, Loader2, Send, X } from "lucide-react";
import { useState } from "react";

import { chf } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { DescribedChange } from "@/lib/types";
import { Avatar, Button, StatusPill, clsx } from "./ui";

export function ChangeRow({ c, onRemove }: { c: DescribedChange; onRemove?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">
          {c.owner_name && <span className="text-muted">{c.owner_name} · </span>}
          {c.label}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <span className="tnum text-muted line-through decoration-subtle/60">{c.previous_text}</span>
          <ArrowRight size={12} className="text-subtle" />
          <span className="tnum font-semibold text-ink">{c.value_text}</span>
          {c.delta_monthly_chf !== null && Math.abs(c.delta_monthly_chf) >= 1 && (
            <span className={clsx("tnum rounded px-1 text-[11.5px] font-medium", c.delta_monthly_chf < 0 ? "bg-good-soft text-good" : "bg-warn-soft text-warn")}>
              {chf(c.delta_monthly_chf, { sign: true })}/mo
            </span>
          )}
        </div>
      </div>
      {onRemove && (
        <button onClick={onRemove} aria-label={`Remove change ${c.label}`} className="mt-0.5 rounded p-1 text-subtle hover:bg-page hover:text-ink">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function autoTitle(changes: DescribedChange[]): string {
  const part = (c: DescribedChange) => `${c.owner_name ? c.owner_name + "'s " + c.label.toLowerCase() : c.label}: ${c.value_text}`;
  const t = changes.slice(0, 2).map(part).join(" · ");
  return changes.length > 2 ? `${t} (+${changes.length - 2} more)` : t;
}

export function DraftBar() {
  const { draft, sim, simLoading, discardDraft, removeChange, propose, viewer, name, idx, preview, stopPreview, ws, sheet } = useStore();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const described = sim?.changes ?? [];

  if (!draft.length && !preview) return null;
  const ev = preview?.sim?.evaluation ?? sim?.evaluation;
  const base = sim?.base;
  const approvers = sim?.approvers ?? [];
  const others = approvers.filter((a) => a !== viewer);
  const selfOnly = others.length === 0;

  return (
    <div className={clsx("fixed inset-x-0 bottom-0 z-30 px-3 pb-3 sm:px-6 sm:pb-4", sheet && "lg:right-[440px]")}>
      <div className="mx-auto max-w-[1072px]">
        {preview && (
          <div className="fade-up mb-2 flex items-center justify-between gap-3 rounded-xl bg-brand px-4 py-2 text-[13px] text-white shadow-lg">
            <span className="flex min-w-0 items-center gap-2">
              <Eye size={15} className="shrink-0" />
              <span className="truncate">Previewing: <b>{preview.label}</b> — nothing is saved</span>
            </span>
            <button onClick={stopPreview} className="shrink-0 rounded-md bg-white/15 px-2.5 py-1 text-[12.5px] font-medium hover:bg-white/25">End preview</button>
          </div>
        )}
        {draft.length > 0 && (
          <div className="fade-up flex flex-col gap-3 rounded-2xl border border-line bg-white px-4 py-3 shadow-[0_8px_30px_rgb(15_23_42/0.12)] lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-semibold text-ink">{draft.length} unsaved change{draft.length > 1 ? "s" : ""}</span>
              {base && <StatusPill status={base.status} size="sm" />}
              <ArrowRight size={13} className="text-subtle" />
              {ev ? <StatusPill status={ev.status} size="sm" /> : null}
              {simLoading && <Loader2 size={13} className="animate-spin text-subtle" />}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Popover.Root>
                <Popover.Trigger asChild>
                  <Button variant="ghost" size="sm">Review</Button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content side="top" align="end" sideOffset={10} className="z-50 w-[min(420px,calc(100vw-1.5rem))] rounded-2xl border border-line bg-white p-4 shadow-xl">
                    <div className="mb-1 text-[13px] font-semibold">Changes in your draft</div>
                    <div className="max-h-[300px] divide-y divide-line overflow-y-auto">
                      {described.map((c) => <ChangeRow key={c.path} c={c} onRemove={() => removeChange(c.path)} />)}
                    </div>
                    <label className="mt-3 block text-[12px] font-medium text-muted" htmlFor="proposal-title">Title</label>
                    <input id="proposal-title" value={title} placeholder={autoTitle(described)} onChange={(e) => setTitle(e.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-line-strong px-3 text-[13px] outline-none focus:ring-2 focus:ring-accent/30" />
                    {ev?.status === "conflict" && <p className="mt-2 text-[12px] font-medium text-bad-strong">This draft creates a conflict — see “Ways to make it work” on the plan.</p>}
                    <p className="mt-2 text-[12px] text-muted">
                      {selfOnly ? "Only your own plan is affected — you can apply this directly." : `Needs approval from ${others.map(name).join(" & ")} before it becomes part of your agreed plan.`}
                    </p>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
              <Button variant="ghost" size="sm" onClick={discardDraft}>
                Discard
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={busy || simLoading || !ws}
                onClick={async () => {
                  setBusy(true);
                  await propose(title || autoTitle(described));
                  setTitle("");
                  setBusy(false);
                }}
              >
                {selfOnly ? "Save to my plan" : (
                  <>
                    <Send size={14} /> Propose to {others.map(name).join(" & ")}
                    <span className="ml-0.5 flex -space-x-1">{others.map((o) => <Avatar key={o} name={name(o)} index={idx(o)} size={18} ring />)}</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
