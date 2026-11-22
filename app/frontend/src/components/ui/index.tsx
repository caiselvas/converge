"use client";

import clsx from "clsx";
import { ChevronDown, Info, Loader2, Lock, Minus, Plus } from "lucide-react";
import * as RTooltip from "@radix-ui/react-tooltip";
import { forwardRef, useId, useState } from "react";

import { chf, monthLabel, num } from "@/lib/format";

export { clsx };

// ---------------------------------------------------------------- layout

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("rounded-2xl border border-line bg-surface shadow-card", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, icon }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3 sm:px-6">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 text-muted">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[13px] leading-5 text-muted">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">{children}</h2>
      {hint && <div className="text-[12px] text-subtle">{hint}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- buttons

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle" | "accent";
type BtnSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

/**
 * Touch targets: 44px on phones for md/icon, 40px for sm; one step smaller from `sm:` up,
 * where a pointer is precise.
 */
const BTN_SIZE: Record<BtnSize, string> = {
  sm: "h-10 px-3.5 text-[13.5px] sm:h-9 sm:px-3",
  md: "h-11 px-4 text-[14.5px] sm:h-10",
  lg: "h-12 px-5 text-[15px]",
  icon: "h-11 w-11 sm:h-10 sm:w-10",
  "icon-sm": "h-10 w-10 sm:h-9 sm:w-9",
};

export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize; loading?: boolean }>(
  function Button({ variant = "secondary", size = "md", loading = false, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={clsx(
          "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-45",
          BTN_SIZE[size],
          variant === "primary" && "bg-ink text-white shadow-[0_1px_2px_rgb(16_24_40/0.12)] hover:bg-ink-2",
          variant === "accent" && "bg-accent text-white shadow-[0_1px_2px_rgb(16_24_40/0.12)] hover:bg-[#095f69]",
          variant === "secondary" && "border border-line-strong bg-white text-ink hover:bg-page",
          variant === "ghost" && "text-ink-2 hover:bg-sunken",
          variant === "subtle" && "bg-sunken text-ink hover:bg-line",
          variant === "danger" && "border border-line-strong bg-white text-bad-strong hover:bg-bad-soft",
          className,
        )}
        {...rest}
      >
        {loading && <Loader2 size={15} className="animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);
// ---------------------------------------------------------------- badges

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "good" | "warn" | "bad" | "info" | "p0" | "p1"; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap",
        tone === "neutral" && "bg-page text-ink-2 ring-1 ring-line",
        tone === "good" && "bg-good-soft text-good",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "bad" && "bg-bad-soft text-bad-strong",
        tone === "info" && "bg-[#e8f1f8] text-brand",
        tone === "p0" && "bg-p0-soft text-p0",
        tone === "p1" && "bg-p1-soft text-p1",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status, size = "md" }: { status: "on_track" | "attention" | "conflict"; size?: "sm" | "md" }) {
  const map = {
    on_track: { t: "On track", c: "bg-good-soft text-good", d: "bg-good" },
    attention: { t: "Needs attention", c: "bg-warn-soft text-warn", d: "bg-warn" },
    conflict: { t: "Conflict", c: "bg-bad-soft text-bad-strong", d: "bg-bad-strong" },
  }[status];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full font-medium", map.c, size === "sm" ? "px-2 py-0.5 text-[11.5px]" : "px-2.5 py-1 text-[13px]")}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", map.d)} />
      {map.t}
    </span>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  dataset: "UBS data",
  derived: "From UBS data",
  official: "Published source",
  illustrative: "Assumption",
  user: "Your input",
};

export function SourceTag({ kind }: { kind: keyof typeof SOURCE_LABEL | string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded px-1.5 py-px text-[10.5px] font-medium uppercase tracking-wide",
        kind === "dataset" || kind === "derived" ? "bg-[#e8f1f8] text-brand" : kind === "official" ? "bg-good-soft text-good" : kind === "user" ? "bg-p0-soft text-p0" : "bg-page text-muted ring-1 ring-line",
      )}
    >
      {SOURCE_LABEL[kind] ?? kind}
    </span>
  );
}

export function Avatar({ name, index, size = 28, ring }: { name: string; index: number; size?: number; ring?: boolean }) {
  return (
    <span
      aria-hidden
      className={clsx("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", ring && "ring-2 ring-white")}
      style={{ width: size, height: size, fontSize: size * 0.42, background: index === 0 ? "var(--color-p0)" : index === 1 ? "var(--color-p1)" : "var(--color-shared)" }}
    >
      {name.slice(0, 1)}
    </span>
  );
}

// ---------------------------------------------------------------- tooltip

export function Tip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <RTooltip.Root delayDuration={150}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content sideOffset={6} className="z-50 max-w-xs rounded-lg bg-ink px-3 py-2 text-[12.5px] leading-5 text-white shadow-lg">
          {content}
          <RTooltip.Arrow className="fill-ink" />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export function InfoTip({ content }: { content: React.ReactNode }) {
  return (
    <Tip content={content}>
      <button type="button" aria-label="More information" className="inline-flex text-subtle hover:text-muted">
        <Info size={14} />
      </button>
    </Tip>
  );
}

// ---------------------------------------------------------------- disclosure

export function Disclosure({ label, children, defaultOpen = false, className }: { label: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={className}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="inline-flex min-h-10 items-center gap-1 rounded-lg text-[14px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        {label}
        <ChevronDown size={15} className={clsx("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div id={id} className="fade-up mt-2">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- inputs

export function Segmented<T extends string>({ value, options, onChange, size = "md", ariaLabel, full = false, className }: {
  value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void; size?: "sm" | "md" | "lg";
  ariaLabel?: string; full?: boolean; className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel}
      className={clsx("rounded-xl bg-sunken p-1", full ? "grid auto-cols-fr grid-flow-col" : "inline-flex", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "inline-flex items-center justify-center gap-1.5 rounded-[9px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45",
            size === "sm" ? "min-h-8 px-3 text-[13px]" : size === "lg" ? "min-h-10 px-4 text-[14.5px]" : "min-h-9 px-3.5 text-[14px]",
            value === o.value ? "bg-white text-ink shadow-[0_1px_2px_rgb(16_24_40/0.10)] ring-1 ring-line" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx("relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50", checked ? "bg-accent" : "bg-line-strong")}
    >
      <span className={clsx("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

/** Numeric field with ± steppers that commits on blur/enter. */
export function NumberField({
  value, onChange, step = 10, min = 0, max, prefix = "CHF", suffix, width = 120, ariaLabel, changed, disabled, decimals = 0,
}: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; prefix?: string; suffix?: string;
  width?: number | string; ariaLabel: string; changed?: boolean; disabled?: boolean; decimals?: number;
}) {
  // Formatted value is shown unless the user is typing; edits commit on blur/enter.
  const [editing, setEditing] = useState<string | null>(null);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min, v));
  const commit = () => {
    if (editing === null) return;
    const parsed = Number(editing.replace(/[’',\s]/g, "").replace("−", "-"));
    if (editing.trim() !== "" && Number.isFinite(parsed)) onChange(clamp(Number(parsed.toFixed(decimals))));
    setEditing(null);
  };
  const text = editing ?? num(value, decimals);
  return (
    <div className={clsx("inline-flex h-11 max-w-full items-center rounded-xl border bg-white transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25 sm:h-10", changed ? "border-accent" : "border-line-strong", disabled && "opacity-60")} style={{ width }}>
      <button type="button" aria-label={`Decrease ${ariaLabel}`} disabled={disabled} onClick={() => onChange(clamp(value - step))} className="flex h-full w-10 shrink-0 items-center justify-center rounded-l-xl text-muted hover:bg-page hover:text-ink">
        <Minus size={15} />
      </button>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
        {prefix && <span className="text-[12px] text-subtle">{prefix}</span>}
        <input
          aria-label={ariaLabel}
          inputMode="decimal"
          disabled={disabled}
          className="tnum w-full min-w-0 bg-transparent text-center text-[16px] font-semibold text-ink outline-none sm:text-[14.5px]"
          value={text}
          onFocus={() => setEditing(num(value, decimals))}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        {suffix && <span className="text-[12px] text-subtle">{suffix}</span>}
      </div>
      <button type="button" aria-label={`Increase ${ariaLabel}`} disabled={disabled} onClick={() => onChange(clamp(value + step))} className="flex h-full w-10 shrink-0 items-center justify-center rounded-r-xl text-muted hover:bg-page hover:text-ink">
        <Plus size={15} />
      </button>
    </div>
  );
}

export function Range({ value, min, max, step, onChange, ariaLabel, color }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; ariaLabel: string; color?: string }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className="range w-full"
      aria-label={ariaLabel}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ ["--range-fill" as string]: `${fill}%`, ["--range-color" as string]: color ?? "var(--color-ink)" }}
    />
  );
}

export function MonthField({ value, onChange, ariaLabel, min, max, changed }: { value: string; onChange: (v: string) => void; ariaLabel: string; min?: string; max?: string; changed?: boolean }) {
  return (
    <input
      type="month"
      aria-label={ariaLabel}
      value={value}
      min={min}
      max={max}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      className={clsx("tnum h-11 max-w-full rounded-xl border bg-white px-3 text-[16px] font-semibold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 sm:h-10 sm:text-[14.5px]", changed ? "border-accent" : "border-line-strong")}
    />
  );
}

export function Field({ label, hint, children, changedFrom }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; changedFrom?: string | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium text-ink">{label}</div>
        {(hint || changedFrom) && (
          <div className="text-[12px] text-muted">
            {changedFrom ? <span className="text-accent">was {changedFrom}</span> : hint}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export function LockedNote({ owner }: { owner: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-page px-3 py-2 text-[12.5px] text-muted ring-1 ring-line">
      <Lock size={13} /> Changes you make here are suggestions — {owner} has to approve them.
    </div>
  );
}

// ---------------------------------------------------------------- data display

export function Stat({ label, value, sub, tone, tip }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "bad" | "warn"; tip?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[12.5px] font-medium text-muted">
        {label}
        {tip && <InfoTip content={tip} />}
      </div>
      <div className={clsx("tnum mt-1 text-[22px] leading-tight font-semibold tracking-tight", tone === "bad" ? "text-bad-strong" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-ink")}>{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

export function Delta({ before, after, format = (x: number) => chf(x, { compact: true }), goodWhenUp = true, className }: { before: number; after: number; format?: (x: number) => string; goodWhenUp?: boolean; className?: string }) {
  const d = after - before;
  if (Math.abs(d) < 0.5) return <span className={clsx("text-[12px] text-subtle", className)}>no change</span>;
  const good = goodWhenUp ? d > 0 : d < 0;
  return (
    <span className={clsx("tnum text-[12px] font-medium", good ? "text-good" : "text-bad-strong", className)}>
      {d > 0 ? "+" : "−"}
      {format(Math.abs(d))}
    </span>
  );
}

export function Progress({ value, tone = "ink", className }: { value: number; tone?: "ink" | "good" | "warn" | "bad" | "p0" | "p1"; className?: string }) {
  const color = { ink: "bg-ink", good: "bg-good", warn: "bg-warn", bad: "bg-bad-strong", p0: "bg-p0", p1: "bg-p1" }[tone];
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-page ring-1 ring-line/60", className)}>
      <div className={clsx("h-full rounded-full transition-all duration-300", color)} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function MonthText({ m }: { m: string }) {
  return <span className="tnum">{monthLabel(m)}</span>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("pulse-soft rounded-lg bg-line/70", className)} />;
}
