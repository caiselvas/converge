"use client";

import { AlertOctagon, AlertTriangle, ChevronDown } from "lucide-react";
import { useState } from "react";

import { chf, monthLabel } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Issue } from "@/lib/types";
import { Avatar, clsx } from "./ui";

export function IssueCard({ issue, compact }: { issue: Issue; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const { name, idx } = useStore();
  const hard = issue.severity === "hard";
  const max = Math.max(1, ...issue.drivers.map((d) => d.amount_chf));
  return (
    <div className={clsx("rounded-xl border px-4 py-3", hard ? "border-[#f3d3cb] bg-bad-soft/60" : "border-[#f1e1bf] bg-warn-soft/60")}>
      <div className="flex items-start gap-3">
        {hard ? <AlertOctagon size={17} className="mt-0.5 shrink-0 text-bad-strong" /> : <AlertTriangle size={17} className="mt-0.5 shrink-0 text-warn" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold text-ink">{issue.title}</span>
            <span className={clsx("rounded px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide", hard ? "bg-white text-bad-strong" : "bg-white text-warn")}>
              {hard ? "Must fix" : "Goal at risk"}
            </span>
          </div>
          {!compact && <p className="mt-1 text-[12.5px] leading-5 text-ink-2">{issue.detail}</p>}
          {issue.drivers.length > 0 && (
            <button onClick={() => setOpen(!open)} aria-expanded={open} className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
              Why?
              <ChevronDown size={13} className={clsx("transition-transform", open && "rotate-180")} />
            </button>
          )}
          {open && (
            <div className="fade-up mt-2 rounded-lg bg-white/80 p-3 ring-1 ring-line">
              {compact && <p className="mb-2 text-[12.5px] leading-5 text-ink-2">{issue.detail}</p>}
              <div className="mb-2 flex items-center gap-2 text-[12px] text-muted">
                {issue.person && <Avatar name={name(issue.person)} index={idx(issue.person)} size={18} />}
                Main drivers{issue.worst_month ? ` up to ${monthLabel(issue.worst_month)}` : ""}
              </div>
              <div className="space-y-1.5">
                {issue.drivers.slice(0, 5).map((d) => (
                  <div key={d.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 text-[12.5px]">
                    <span className="truncate text-ink-2">{d.label}</span>
                    <span className="tnum font-medium text-ink">{chf(d.amount_chf)}</span>
                    <div className="col-span-2 h-1 overflow-hidden rounded-full bg-page">
                      <div className={clsx("h-full rounded-full", hard ? "bg-bad/70" : "bg-warn/70")} style={{ width: `${(d.amount_chf / max) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              {issue.kind === "liquidity_floor" && (
                <p className="mt-2.5 text-[11.5px] leading-4 text-muted">
                  Cumulative amounts from the start of the plan. Regular income and spending continue alongside these items.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
