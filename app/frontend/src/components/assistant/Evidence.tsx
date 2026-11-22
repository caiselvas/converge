"use client";

import { ArrowDownRight, ArrowUpRight, Check, Loader2, Wrench, X } from "lucide-react";

import { chf, monthLabel } from "@/lib/format";
import type { WhatIfResult } from "@/lib/types";
import type { ToolActivity } from "@/lib/voice";
import { clsx } from "../ui";

const TOOL_LABELS: Record<string, string> = {
  education_programs: "Looked up programme fees and duration",
  explore_what_if: "Ran a what-if simulation",
  simulate_changes: "Simulated plan changes",
  get_summary: "Checked cash buffers and goals",
  get_profile: "Read the financial profile",
  get_gaps: "Checked known goals and open questions",
  compare_paths: "Compared alternative paths",
  list_recommendations: "Tested possible adjustments",
  propose_changes: "Prepared changes for review",
  save_memory: "Saved profile notes for review",
};

/** Which engine tools the assistant used in a turn. Results always come from the engine, not the model. */
export function ToolActivityLog({ entries }: { entries: ToolActivity[] }) {
  if (!entries.length) return null;
  return (
    <div className="rounded-xl bg-white/70 px-3 py-2 text-[12.5px] text-muted ring-1 ring-line">
      <p className="flex items-center gap-1.5 font-medium text-ink-2"><Wrench size={13} aria-hidden /> Engine tools</p>
      <ul className="mt-1 space-y-0.5" aria-live="polite">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-center gap-1.5">
            {entry.status === "running" ? <Loader2 size={13} className="animate-spin" aria-hidden />
              : entry.status === "done" ? <Check size={13} className="text-good" aria-hidden />
                : <X size={13} className="text-bad-strong" aria-hidden />}
            <span>{TOOL_LABELS[entry.name] ?? "Used an engine tool"}</span>
            {entry.status === "failed" && <span className="text-bad-strong">· couldn’t complete</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Before/after figures from a paired engine comparison (per partner and combined). */
export function EvidenceCards({ result }: { result: WhatIfResult }) {
  return (
    <div className="space-y-2">
      <p className="text-[12px] font-medium text-muted">Simulated by the engine · {monthLabel(result.start)} – {monthLabel(result.end)}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {result.scenario.map((after, i) => {
          const before = result.baseline[i];
          const combined = after.cash_floor === null;
          const change = combined ? (after.change_in_end_net_worth ?? after.end_net_worth - before.end_net_worth)
            : (after.change_in_minimum_cash ?? after.minimum_cash - before.minimum_cash);
          const Direction = change < 0 ? ArrowDownRight : ArrowUpRight;
          const below = (after.buffer_gap ?? 0) < -0.01;
          return (
            <article key={after.id} className="rounded-xl bg-white p-3 ring-1 ring-line">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                <span className={clsx("size-2 rounded-full", i === 0 ? "bg-p0" : i === 1 ? "bg-p1" : "bg-shared")} aria-hidden />
                {after.name}
              </p>
              <p className="mt-2 text-[12px] text-muted">{combined ? "Net worth at the end" : "Lowest month-end cash"}</p>
              <p className="tnum text-[17px] font-semibold tracking-tight">{chf(combined ? after.end_net_worth : after.minimum_cash)}</p>
              <p className={clsx("tnum mt-0.5 flex items-center gap-1 text-[12px] font-medium",
                change < -0.01 ? "text-bad-strong" : change > 0.01 ? "text-good" : "text-muted")}>
                {Math.abs(change) >= 0.01 && <Direction size={13} aria-hidden />}
                {chf(change, { sign: true })} vs now
              </p>
              {!combined && <p className={clsx("mt-2 border-t border-line pt-1.5 text-[12px]", below ? "text-bad-strong" : "text-muted")}>
                {chf(Math.abs(after.buffer_gap ?? 0))} {below ? "below" : "above"} buffer · {monthLabel(after.minimum_cash_month)}
              </p>}
            </article>
          );
        })}
      </div>
    </div>
  );
}
