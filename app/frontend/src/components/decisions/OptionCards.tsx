"use client";

import { Award, Clock, Heart, Plus, ShieldCheck, TrendingUp, X } from "lucide-react";

import { chf } from "@/lib/format";
import type { ComparisonColumn } from "@/lib/types";
import { clsx } from "../ui";
import { KIND_LABEL, type OptionStyle } from "./registry";

const LABEL_ICON = { safest: ShieldCheck, soonest: Clock, wealth: TrendingUp, preferences: Heart } as const;

export function LabelChip({ label }: { label: ComparisonColumn["labels"][number] }) {
  const Icon = LABEL_ICON[label.id] ?? Award;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-medium text-accent">
      <Icon size={12} aria-hidden /> {label.text}
    </span>
  );
}

function Card({ col, style, selected, onSelect, onRemove }: {
  col: ComparisonColumn; style: OptionStyle; selected: boolean; onSelect: () => void; onRemove?: () => void;
}) {
  const unsafe = col.people.filter((p) => !p.safe);
  return (
    <div className={clsx("relative flex w-[min(80vw,300px)] shrink-0 snap-start flex-col rounded-2xl border bg-white p-4 text-left shadow-card transition-[border-color,box-shadow] md:w-auto",
      selected ? "border-ink ring-1 ring-ink" : "border-line hover:border-line-strong")}>
      <button type="button" onClick={onSelect} aria-pressed={selected}
        className="absolute inset-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
        aria-label={`Select ${col.title}`} />
      <div className="pointer-events-none flex items-center gap-2 pr-8">
        <svg width="18" height="8" aria-hidden className="shrink-0">
          <line x1="1" y1="4" x2="17" y2="4" stroke={style.color} strokeWidth="3" strokeDasharray={style.dash} strokeLinecap="round" />
        </svg>
        <span className="truncate text-[12px] font-medium text-muted">{KIND_LABEL[col.kind]}</span>
      </div>
      {onRemove && <button type="button" onClick={onRemove} aria-label={`Remove ${col.title}`}
        className="absolute top-2 right-2 z-10 grid h-10 w-10 place-items-center rounded-full text-subtle hover:bg-page hover:text-ink">
        <X size={16} />
      </button>}
      <h4 className="pointer-events-none mt-1.5 text-[15.5px] leading-snug font-semibold tracking-tight text-ink">{col.title}</h4>
      {col.summary.length > 0 && <p className="pointer-events-none mt-1 line-clamp-2 text-[13px] leading-5 text-muted">{col.summary.join(" · ")}</p>}
      <div className="pointer-events-none mt-3 flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-muted">Net worth, end</span>
        <span className="tnum text-[16px] font-semibold">{chf(col.end_net_worth, { compact: true })}</span>
      </div>
      <p className={clsx("pointer-events-none mt-2 text-[13px] font-medium", col.safe ? "text-good" : "text-bad-strong")}>
        {col.safe ? "Both buffers hold" : unsafe.length ? `${unsafe.map((p) => p.name).join(" & ")} below buffer` : col.issue ?? "Fails a safety check"}
      </p>
      {col.labels.length > 0 && <div className="pointer-events-none mt-2 flex flex-wrap gap-1">{col.labels.map((l) => <LabelChip key={l.id} label={l} />)}</div>}
      {col.tradeoff && col.kind !== "yours" && <p className="pointer-events-none mt-2 line-clamp-3 text-[12.5px] leading-5 text-ink-2">{col.tradeoff}</p>}
    </div>
  );
}

/** Option cards: swipe on phones, a grid on larger screens. */
export function OptionCards({ columns, styles, selected, onSelect, onRemove, onAdd, canAdd }: {
  columns: ComparisonColumn[]; styles: Record<string, OptionStyle>; selected: string; onSelect: (id: string) => void;
  onRemove: (id: string) => void; onAdd: () => void; canAdd: boolean;
}) {
  return (
    <div role="group" aria-label="Options to compare"
      className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-[repeat(auto-fill,minmax(230px,1fr))] md:overflow-visible md:px-0">
      {columns.map((c) => <Card key={c.id} col={c} style={styles[c.id]} selected={c.id === selected} onSelect={() => onSelect(c.id)}
        onRemove={c.kind === "option" ? () => onRemove(c.id) : undefined} />)}
      {canAdd && <button type="button" onClick={onAdd}
        className="flex min-h-[150px] w-[min(60vw,220px)] shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong bg-white/60 p-4 text-[14px] font-medium text-ink-2 hover:border-ink hover:text-ink md:w-auto">
        <Plus size={20} /> Add an option
        <span className="text-center text-[12.5px] font-normal text-muted">Starts as a copy of the selected one</span>
      </button>}
    </div>
  );
}
