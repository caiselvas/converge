"use client";

import { Check } from "lucide-react";

import { chf } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { DecisionQuestion } from "@/lib/types";
import { Avatar, MonthField, NumberField, Range, Segmented, clsx } from "../ui";

/** The value a partner currently holds for a question (their own preference, or the shared answer). */
export function currentValue(q: DecisionQuestion, viewer: string): unknown {
  return q.per_partner ? q.answers?.[viewer]?.value : q.value;
}

export function QuestionInput({ q, value, onChange, autoFocus }: {
  q: DecisionQuestion; value: unknown; onChange: (v: unknown) => void; autoFocus?: boolean;
}) {
  const { ws, idx } = useStore();
  const label = q.label;

  if (q.kind === "choice") {
    return (
      <div role="radiogroup" aria-label={label} className="grid gap-2">
        {q.options.map((o, i) => {
          const on = value === o.value;
          return (
            <button key={o.value} type="button" role="radio" aria-checked={on} autoFocus={autoFocus && i === 0}
              onClick={() => onChange(o.value)}
              className={clsx("flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                on ? "border-accent bg-[#eef7f7] text-ink" : "border-line-strong bg-white text-ink-2 hover:bg-page")}>
              <span>{o.label}</span>
              <span className={clsx("grid h-5 w-5 shrink-0 place-items-center rounded-full border", on ? "border-accent bg-accent text-white" : "border-line-strong")}>
                {on && <Check size={12} strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  if (q.kind === "partner" && ws) {
    return (
      <Segmented ariaLabel={label} value={String(value ?? "")} onChange={onChange}
        options={ws.people.map((p) => ({ value: p.id, label: <span className="flex items-center gap-1.5"><Avatar name={p.name} index={idx(p.id)} size={18} />{p.name}</span> }))} />
    );
  }

  if (q.kind === "bool") {
    return (
      <Segmented ariaLabel={label} value={value === true ? "yes" : value === false ? "no" : ""} onChange={(v) => onChange(v === "yes")}
        options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />
    );
  }

  if (q.kind === "month") {
    return <MonthField ariaLabel={label} value={String(value ?? "")} onChange={onChange} />;
  }

  if (q.kind === "share") {
    const v = typeof value === "number" ? value : Number(q.min ?? 0);
    const pctText = `${(v * 100).toFixed(q.decimals)}%`;
    const fine = (q.step ?? 0.01) < 0.01;
    if (fine) {
      return (
        <NumberField ariaLabel={label} value={Number((v * 100).toFixed(q.decimals + 1))} step={(q.step ?? 0.001) * 100}
          min={(q.min ?? 0) * 100} max={(q.max ?? 1) * 100} decimals={q.decimals} prefix="" suffix="%" width={150}
          onChange={(x) => onChange(Number((x / 100).toFixed(5)))} />
      );
    }
    const people = ws?.people ?? [];
    const split = q.id === "ownership_share_first" || q.id === "custom_share_first";
    return (
      <div className="max-w-md">
        <Range ariaLabel={label} value={Math.round(v * 100)} min={Math.round((q.min ?? 0) * 100)} max={Math.round((q.max ?? 1) * 100)}
          step={Math.max(1, Math.round((q.step ?? 0.01) * 100))} color={split ? "var(--color-p0)" : undefined} onChange={(x) => onChange(x / 100)} />
        {split && people.length === 2 ? (
          <div className="tnum mt-2 flex justify-between text-[13px]">
            <span><b className="text-p0">{people[0].name} {Math.round(v * 100)}%</b>{q.amount_base ? <span className="text-muted"> · {chf(q.amount_base * v, { compact: true })}</span> : null}</span>
            <span>{q.amount_base ? <span className="text-muted">{chf(q.amount_base * (1 - v), { compact: true })} · </span> : null}<b className="text-p1">{people[1].name} {Math.round((1 - v) * 100)}%</b></span>
          </div>
        ) : (
          <div className="tnum mt-2 text-[13px]"><b>{pctText}</b>{q.amount_base ? <span className="text-muted"> · {chf(q.amount_base * v)}</span> : null}</div>
        )}
      </div>
    );
  }

  if (q.kind === "chf" || q.kind === "number") {
    const v = typeof value === "number" ? value : Number(q.min ?? 0);
    const money = q.kind === "chf";
    const suffix = money ? (q.unit === "/month" ? "/mo" : undefined) : q.unit.startsWith("%") ? "%" : undefined;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <NumberField ariaLabel={label} value={v} step={q.step ?? (money ? 100 : 1)} min={q.min ?? 0} max={q.max ?? undefined}
          decimals={q.decimals} prefix={money ? "CHF" : ""} suffix={suffix} width={money ? 200 : 150} onChange={onChange} />
        {!money && !q.unit.startsWith("%") && q.unit && <span className="text-[13px] text-muted">{q.unit}</span>}
      </div>
    );
  }

  return (
    <input aria-label={label} value={String(value ?? "")} maxLength={300} onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-lg border border-line-strong bg-white px-3 text-[14px] outline-none focus:ring-2 focus:ring-accent/30" />
  );
}
