"use client";

import { useMemo } from "react";
import {
  CartesianGrid, Line, LineChart, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { chf, chfShort, monthLabel } from "@/lib/format";
import type { Evaluation, SeriesKey } from "@/lib/types";

const COLORS = ["var(--color-p0)", "var(--color-p1)"];
const HEX = ["#3d5bd9", "#0d9488"];

interface Props {
  current: Evaluation;
  base?: Evaluation | null;
  metric?: SeriesKey;
  height?: number;
  only?: number; // show a single partner (index)
  showFloors?: boolean;
  showEvents?: boolean;
  compareLabel?: string;
}

export function CashChart({ current, base, metric = "cash", height = 320, only, showFloors = true, showEvents = true, compareLabel = "Agreed plan" }: Props) {
  const ids = current.people.map((p) => p.id);
  const visible = only === undefined ? [0, 1] : [only];
  const showBase = !!base && visible.some((i) => JSON.stringify(base.series[ids[i]][metric]) !== JSON.stringify(current.series[ids[i]][metric]));

  const data = useMemo(
    () =>
      current.months.map((m, t) => {
        const row: Record<string, number | string> = { m };
        visible.forEach((i) => {
          row[`p${i}`] = current.series[ids[i]][metric][t];
          if (showBase && base && base.months[t] === m) row[`b${i}`] = base.series[ids[i]][metric][t];
        });
        return row;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, base, metric, only, showBase],
  );

  const values = data.flatMap((r) => visible.flatMap((i) => [r[`p${i}`], r[`b${i}`]])).filter((v): v is number => typeof v === "number");
  if (metric === "cash" && showFloors) visible.forEach((i) => values.push(current.people[i].floor));
  const { lo, hi, yTicks } = niceScale(Math.min(0, ...values), Math.max(...values));

  const ticks = current.months.filter((m) => m.endsWith("-01") || m.endsWith("-07"));
  const breaks = current.events.filter((e) => e.kind === "career_break" && (only === undefined || e.person === ids[only]));
  const points = current.events.filter((e) => e.kind !== "career_break" && (only === undefined || !e.person || e.person === ids[only]));

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 56, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#eef0f3" />
          <XAxis dataKey="m" ticks={ticks} tickFormatter={(m) => (m.endsWith("-01") ? m.slice(0, 4) : "")} tick={{ fontSize: 11.5, fill: "#64748b" }} axisLine={{ stroke: "#e5e7eb" }} tickLine={false} interval={0} />
          <YAxis domain={[lo, hi]} ticks={yTicks} tickFormatter={(v) => chfShort(v)} tick={{ fontSize: 11.5, fill: "#64748b" }} axisLine={false} tickLine={false} width={46} />
          {showEvents &&
            breaks.map((e, k) => (
              <ReferenceArea key={`b-${k}-${e.person}-${e.month}`} x1={e.month} x2={e.end && current.months.includes(e.end) ? e.end : current.months[current.months.length - 1]} fill={HEX[ids.indexOf(e.person ?? "")] ?? "#64748b"} fillOpacity={0.07} ifOverflow="hidden" />
            ))}
          {showEvents &&
            points.map((e, k) => (
              <ReferenceLine key={`e-${k}-${e.kind}`} x={e.month} stroke="#94a3b8" strokeDasharray="2 3"
                label={(props: { viewBox?: { x?: number; y?: number } }) => (
                  <text x={(props.viewBox?.x ?? 0) + 4} y={(props.viewBox?.y ?? 0) + 10 + (k % 2) * 13} fontSize={11} fill="#475569">
                    {e.kind === "move_in" ? "Move in" : e.label}
                  </text>
                )} />
            ))}
          {metric === "cash" && showFloors &&
            visible.map((i) => (
              <ReferenceLine key={`f${i}`} y={current.people[i].floor} stroke={HEX[i]} strokeOpacity={0.45} strokeDasharray="5 4" />
            ))}
          {lo < 0 && <ReferenceLine y={0} stroke="#94a3b8" />}
          <Tooltip content={<ChartTooltip current={current} visible={visible} metric={metric} showBase={showBase} compareLabel={compareLabel} />} cursor={{ stroke: "#94a3b8", strokeWidth: 1 }} />
          {showBase && visible.map((i) => <Line key={`b${i}`} dataKey={`b${i}`} stroke={HEX[i]} strokeOpacity={0.4} strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />)}
          {visible.map((i) => (
            <Line key={`p${i}`} dataKey={`p${i}`} stroke={COLORS[i]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={false}
              label={(props: { index?: number; x?: number | string; y?: number | string }) =>
                props.index === data.length - 1 ? (
                  <text x={Number(props.x) + 6} y={Number(props.y) + 4} fontSize={11.5} fontWeight={600} fill="#334155">{current.people[i].name}</text>
                ) : <g />
              }
            />
          ))}
          {metric === "cash" &&
            visible.map((i) => {
              const p = current.people[i];
              if (!p.breach) return null;
              return <ReferenceDot key={`min${i}`} x={p.min_cash_month} y={p.min_cash} r={5} fill="#b91c1c" stroke="#fff" strokeWidth={2} />;
            })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function niceScale(min: number, max: number) {
  const span = Math.max(1, max - min);
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil((max * 1.04) / step) * step;
  const yTicks: number[] = [];
  for (let v = lo; v <= hi + 1e-6; v += step) yTicks.push(v);
  return { lo, hi, yTicks };
}

function ChartTooltip({ active, payload, label, current, visible, metric, showBase, compareLabel }: {
  active?: boolean; payload?: { dataKey: string; value: number }[]; label?: string; current: Evaluation; visible: number[]; metric: SeriesKey; showBase: boolean; compareLabel: string;
}) {
  if (!active || !payload?.length || !label) return null;
  const get = (k: string) => payload.find((p) => p.dataKey === k)?.value;
  const ev = current.events.filter((e) => e.month === label && (!e.person || visible.some((i) => current.people[i].id === e.person)));
  return (
    <div className="min-w-[200px] rounded-xl border border-line bg-white px-3.5 py-3 text-[12.5px] shadow-lg">
      <div className="mb-2 font-semibold text-ink">{monthLabel(label)}</div>
      {visible.map((i) => {
        const v = get(`p${i}`);
        const b = get(`b${i}`);
        const floor = current.people[i].floor;
        return (
          <div key={i} className="mb-1.5 last:mb-0">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-ink-2">
                <span className="h-2 w-2 rounded-full" style={{ background: HEX[i] }} />
                {current.people[i].name}
              </span>
              <span className="tnum font-semibold text-ink">{chf(v)}</span>
            </div>
            {showBase && b !== undefined && (
              <div className="flex justify-between gap-4 pl-3.5 text-muted">
                <span>{compareLabel}</span>
                <span className="tnum">{chf(b)}</span>
              </div>
            )}
            {metric === "cash" && v !== undefined && v < floor && <div className="pl-3.5 font-medium text-bad-strong">{chf(floor - v)} below minimum</div>}
          </div>
        );
      })}
      {ev.length > 0 && <div className="mt-2 border-t border-line pt-2 text-muted">{ev.map((e) => e.label).join(" · ")}</div>}
    </div>
  );
}

export function ChartLegend({ names, only, showBase, compareLabel = "Agreed plan", showFloor = true, showBreak = false }: { names: string[]; only?: number; showBase?: boolean; compareLabel?: string; showFloor?: boolean; showBreak?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted">
      {names.map((n, i) => (only === undefined || only === i) && (
        <span key={n} className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: HEX[i] }} />
          {n}
        </span>
      ))}
      {showBase && (
        <span className="flex items-center gap-1.5">
          <svg width="16" height="2"><line x1="0" y1="1" x2="16" y2="1" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3 3" /></svg>
          {compareLabel}
        </span>
      )}
      {showFloor && (
        <span className="flex items-center gap-1.5">
          <svg width="16" height="2"><line x1="0" y1="1" x2="16" y2="1" stroke="#94a3b8" strokeWidth="1" strokeDasharray="5 4" /></svg>
          Minimum safety buffer
        </span>
      )}
      {showBreak && (
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-3 rounded-sm bg-[#3d5bd9]/10 ring-1 ring-line" />
          Career break
        </span>
      )}
    </div>
  );
}
