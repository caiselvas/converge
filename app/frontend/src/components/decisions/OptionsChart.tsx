"use client";

import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { chf, chfShort, monthLabel } from "@/lib/format";
import type { ComparisonColumn, DecisionComparison } from "@/lib/types";
import { Range, Segmented, clsx } from "../ui";
import type { OptionStyle } from "./registry";

export type Metric = "net_worth" | "gap" | `cash:${string}`;

/** A column's value at month ``t``. ``gap`` is household net worth minus the couple's own plan. */
export function valueAt(col: ComparisonColumn, metric: Metric, t: number, ref?: ComparisonColumn): number | undefined {
  if (metric === "net_worth") return col.net_worth[t];
  if (metric === "gap") return ref ? col.net_worth[t] - ref.net_worth[t] : undefined;
  return col.people.find((p) => p.id === metric.slice(5))?.cash[t];
}

function Swatch({ style }: { style: OptionStyle }) {
  return (
    <svg width="22" height="10" aria-hidden className="shrink-0">
      <line x1="1" y1="5" x2="21" y2="5" stroke={style.color} strokeWidth="2.5" strokeDasharray={style.dash} strokeLinecap="round" />
    </svg>
  );
}

/** One timeline for every option of the decision, with a month scrubber. */
export function OptionsChart({ comparison, styles, selected, onSelect, cursor, setCursor, metric, setMetric, people, fixedPerson }: {
  comparison: DecisionComparison; styles: Record<string, OptionStyle>; selected: string; onSelect: (id: string) => void;
  cursor: number; setCursor: (t: number) => void; metric: Metric; setMetric: (m: Metric) => void;
  people: { id: string; name: string }[]; fixedPerson: string | null;
}) {
  const { months, columns } = comparison;
  const t = Math.min(cursor, months.length - 1);
  const ref = columns[0];
  const cash = metric.startsWith("cash:");
  const gap = metric === "gap";
  const personId = cash ? metric.slice(5) : null;
  const floor = personId ? ref.people.find((p) => p.id === personId)?.floor : undefined;
  const sel = columns.find((c) => c.id === selected) ?? ref;
  const value = (c: ComparisonColumn, i: number) => valueAt(c, metric, i, ref);
  const data = months.map((m, i) => ({ m, ...Object.fromEntries(columns.map((c) => [c.id, value(c, i)])) }));
  const metrics = [
    ...(fixedPerson ? [] : [{ value: "net_worth" as Metric, label: "Net worth" }, { value: "gap" as Metric, label: "vs your plan" }]),
    ...people.filter((p) => !fixedPerson || p.id === fixedPerson).map((p) => ({ value: `cash:${p.id}` as Metric, label: `${p.name}’s cash` })),
    ...(fixedPerson ? [{ value: "net_worth" as Metric, label: "Net worth" }, { value: "gap" as Metric, label: "vs your plan" }] : []),
  ];
  const title = metric === "net_worth" ? "Household net worth" : gap ? "Household net worth compared with your plan"
    : `${people.find((p) => p.id === personId)?.name}’s cash`;
  const ordered = [...columns].sort((a, b) => (value(b, t) ?? 0) - (value(a, t) ?? 0));
  const eventLabel = comparison.event_label.toLowerCase();

  return (
    <section aria-label="Options over time" className="min-w-0 rounded-2xl border border-line bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <div>
          <h3 className="text-[16px] font-semibold tracking-tight">{title}</h3>
          <p className="text-[13px] text-muted">{monthLabel(months[0])} – {monthLabel(months[months.length - 1])} · simulated monthly</p>
        </div>
        {metrics.length > 1 && <div className="no-scrollbar max-w-full overflow-x-auto">
          <Segmented<Metric> size="sm" ariaLabel="Chart measure" value={metric} onChange={setMetric} options={metrics} />
        </div>}
      </div>
      <div className="h-60 px-1 pt-2 sm:h-72 sm:px-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 14, bottom: 0, left: 2 }}
            onMouseMove={(s) => { if (s?.activeTooltipIndex !== undefined && s.activeTooltipIndex !== null) setCursor(Number(s.activeTooltipIndex)); }}>
            <CartesianGrid vertical={false} stroke="#e4e7ec" />
            <XAxis dataKey="m" ticks={months.filter((m, i) => m.endsWith("-01") && i > 0)} tickFormatter={(m: string) => m.slice(0, 4)}
              tick={{ fontSize: 12, fill: "#5d6b82" }} tickLine={false} axisLine={{ stroke: "#e4e7ec" }} minTickGap={12} />
            <YAxis tickFormatter={chfShort} domain={["auto", "auto"]} tick={{ fontSize: 12, fill: "#5d6b82" }} tickLine={false} axisLine={false} width={50} />
            {gap && <ReferenceLine y={0} stroke="#101828" strokeOpacity={0.5} />}
            <Tooltip content={() => null} cursor={false} isAnimationActive={false} />
            {floor !== undefined && <ReferenceLine y={floor} stroke="#c4320a" strokeOpacity={0.6} strokeDasharray="3 4" ifOverflow="extendDomain"
              label={{ value: "Safety buffer", position: "insideBottomRight", fontSize: 11, fill: "#c4320a" }} />}
            <ReferenceLine x={months[t]} stroke="#101828" strokeOpacity={0.35} />
            {columns.map((c) => {
              const style = styles[c.id];
              const on = c.id === sel.id;
              return <Line key={c.id} dataKey={c.id} name={c.title} stroke={style.color} strokeDasharray={style.dash}
                strokeWidth={on ? 3 : 1.75} strokeOpacity={on ? 1 : 0.55} dot={false} activeDot={false} isAnimationActive={false} />;
            })}
            {columns.map((c) => {
              const i = c.event ? months.indexOf(c.event) : -1;
              const y = i >= 0 ? value(c, i) : undefined;
              return i >= 0 && y !== undefined ? <ReferenceDot key={`e-${c.id}`} x={months[i]} y={y} r={c.id === sel.id ? 5 : 3.5}
                fill={styles[c.id].color} stroke="#fff" strokeWidth={1.5} /> : null;
            })}
            {cash && sel.people.find((p) => p.id === personId)?.breaches.slice(0, 40).map((i) =>
              <ReferenceDot key={`b-${i}`} x={months[i]} y={value(sel, i)} r={2.5} fill="#b42318" stroke="none" />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="border-t border-line px-4 pt-3 pb-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="tnum w-[76px] shrink-0 text-[14px] font-semibold">{monthLabel(months[t])}</span>
          <Range ariaLabel="Month to inspect" value={t} min={0} max={months.length - 1} step={1} onChange={setCursor} />
        </div>
        <ul className="mt-3 divide-y divide-line">
          {ordered.map((c) => {
            const v = value(c, t);
            const base = value(ref, t);
            const diff = !gap && v !== undefined && base !== undefined && c.id !== ref.id ? v - base : null;
            return (
              <li key={c.id}>
                <button type="button" onClick={() => onSelect(c.id)} aria-pressed={c.id === sel.id}
                  className={clsx("flex min-h-12 w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-page",
                    c.id === sel.id && "bg-page")}>
                  <Swatch style={styles[c.id]} />
                  <span className="min-w-0 flex-1">
                    <span className={clsx("block truncate text-[14px]", c.id === sel.id ? "font-semibold text-ink" : "text-ink-2")}>{c.title}</span>
                    <span className="flex flex-wrap gap-x-2 text-[12px] text-muted">
                      {c.people.map((p) => <span key={p.id} className={p.safe ? "" : "font-medium text-bad-strong"}>
                        {p.name} {p.safe ? `+${chfShort(p.headroom)}` : "below buffer"}
                      </span>)}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="tnum block text-[14.5px] font-semibold">{v === undefined ? "—" : chf(v, { compact: true, sign: gap })}</span>
                    {diff !== null && Math.abs(diff) >= 1 && <span className={clsx("tnum block text-[12px]", diff > 0 ? "text-good" : "text-bad-strong")}>
                      {chf(diff, { sign: true, compact: true })}
                    </span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[12px] leading-5 text-muted">
          Solid lines are your options; dashed lines are alternatives Converge tested. A dot marks the {eventLabel || "decision"}.
          Below each name: lowest cash above each safety buffer over the whole projection.
        </p>
      </div>
    </section>
  );
}
