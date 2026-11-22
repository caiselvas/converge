"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { useStore } from "@/lib/store";
import type { DecisionSummary } from "@/lib/types";
import { clsx } from "../ui";
import { STATUS_LABEL, decisionHref, DecisionIcon } from "./registry";

function StatusChip({ d }: { d: DecisionSummary }) {
  if (d.status === "not_started") return null;
  const tone = d.status === "in_plan" ? "bg-good-soft text-good" : d.status === "proposed" ? "bg-warn-soft text-warn" : "bg-page text-ink-2 ring-1 ring-line";
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap", tone)}>
      {STATUS_LABEL[d.status]}
      {d.status === "in_progress" && d.progress.total > 0 && <span className="tnum ml-1 opacity-70">{d.progress.done}/{d.progress.total}</span>}
    </span>
  );
}

function DecisionCard({ d }: { d: DecisionSummary }) {
  const { scope, scopedPerson } = useStore();
  const action = d.status === "not_started" ? "Start planning" : d.status === "in_plan" ? "Review or change" : "Continue";
  return (
    <Link href={decisionHref(d.id, scope, { subject: scopedPerson?.id })}
      className="group flex min-h-[208px] flex-col rounded-2xl border border-line bg-white p-5 transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-[0_6px_24px_rgb(15_23_42/0.07)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-page text-brand ring-1 ring-line"><DecisionIcon id={d.id} /></span>
        <StatusChip d={d} />
      </div>
      <h3 className="mt-4 text-[17px] font-semibold tracking-tight text-ink">{d.title}</h3>
      <p className="mt-1.5 text-[13.5px] leading-5 text-muted">{d.promise}</p>
      <div className="mt-auto flex items-center justify-between gap-3 pt-5">
        <span className="tnum min-w-0 truncate text-[12.5px] text-ink-2">{d.headline ?? ""}</span>
        <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-accent">
          {action} <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

export function LifeDecisions() {
  const { ws, scopedPerson } = useStore();
  if (!ws) return null;
  return (
    <section aria-labelledby="life-decisions">
      <h2 id="life-decisions" className="text-[20px] font-semibold tracking-tight">Plan a life decision</h2>
      <p className="mt-1 max-w-2xl text-[14px] leading-6 text-muted">
        Answer a few questions together. Converge turns your answers into a plan, simulates it with your own numbers,
        and nothing changes until you both agree.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {ws.decisions.filter((d) => !scopedPerson || d.id === "career-break").map((d) => <DecisionCard key={d.id} d={d} />)}
      </div>
    </section>
  );
}
