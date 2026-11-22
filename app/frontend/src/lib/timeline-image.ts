import { chf, chfShort, monthLabel } from "./format";
import type { WhatIfLine, WhatIfResult } from "./types";

const colors = ["#0b7255", "#244db4", "#902976", "#a54b19", "#08728a", "#6943ac"];
const ink = "#102e27";
const muted = "#4d655e";
const width = 1280;
const left = 64;
const right = width - left;

type Timeline = { label: string; lines: WhatIfLine[]; color: string; assumptions: string; baseline?: boolean };

export function timelineLabel(result: WhatIfResult) {
  const study = result.inputs.study;
  if (study) return `${study.program} · ${monthLabel(study.start)} · ${study.income_pct}% pay`;
  const home = result.inputs.scenario_home_purchase;
  if (home) return `Joint purchase · ${monthLabel(home.month)} · ${chf(home.price)}`;
  if (result.inputs.housing === "together") {
    const housing = result.inputs.scenario_housing;
    return `Live together · ${monthLabel(housing.move_in)} · ${chf(housing.rent)}/month`;
  }
  return result.inputs.housing === "separate" ? "Live separately" : "What-if plan";
}

function labelInputs(result: WhatIfResult) {
  const study = result.inputs.study;
  if (!study) return "";
  const costs = `${chf(study.semester_fee_chf)}/semester · ${chf(study.extra_cost_chf)} extra costs · ${chf(study.monthly_pay_delta, { sign: true })}/month after study`;
  const replaced = study.replaced_breaks?.length ? " · Replaces overlapping leave in this path" : "";
  const defaulted = result.assumed_inputs?.includes("take-home pay during study") ? " · Study pay assumed" : "";
  return costs + replaced + defaulted;
}

export function sameTimelineBaseline(a: WhatIfResult, b: WhatIfResult) {
  return JSON.stringify([a.months, a.baseline]) === JSON.stringify([b.months, b.baseline]);
}

export function addTimeline(previous: WhatIfResult[], result: WhatIfResult) {
  if (!result.months?.length) return previous;
  if (previous.length && !sameTimelineBaseline(previous[0], result)) return [result];
  const key = JSON.stringify([result.inputs, result.scenario]);
  return previous.some((entry) => JSON.stringify([entry.inputs, entry.scenario]) === key) ? previous : [...previous, result];
}

export async function timelineImage(results: WhatIfResult[]) {
  const first = results[0];
  if (!first?.months?.length || results.some((result) => !sameTimelineBaseline(first, result))) {
    throw new Error("These timelines need a common baseline before export.");
  }
  const months = first.months;
  const timelines: Timeline[] = [
    { label: "Current plan · baseline", lines: first.baseline, color: "#64748b", assumptions: "", baseline: true },
    ...results.map((result, i) => ({
      label: timelineLabel(result), lines: result.scenario, color: colors[i % colors.length], assumptions: labelInputs(result),
    })),
  ];

  const tableRow = 80;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = 1035 + tableRow * timelines.length;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not draw the comparison image.");
  const g = ctx;

  function text(value: string, x: number, y: number, size: number, color = ink, weight = 400, maxWidth?: number) {
    g.font = `${weight} ${size}px system-ui, sans-serif`;
    g.fillStyle = color;
    g.fillText(value, x, y, maxWidth);
  }

  function line(x1: number, y1: number, x2: number, y2: number, color: string, weight = 1, dash: number[] = []) {
    g.beginPath();
    g.strokeStyle = color;
    g.lineWidth = weight;
    g.setLineDash(dash);
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
    g.setLineDash([]);
  }

  g.fillStyle = "#f3f7f4";
  g.fillRect(0, 0, width, canvas.height);
  g.fillStyle = "#12342b";
  g.fillRect(0, 0, width, 156);
  text("CONVERGE", left, 43, 22, "#b8e8d1", 700);
  text("Your financial timelines", left, 94, 45, "#ffffff", 700);
  text(`${monthLabel(first.start)} to ${monthLabel(first.end)} · Monthly projections in CHF`, left, 128, 23, "#daeee4");

  for (let index = 0; index < first.scenario.length; index++) {
    const combined = first.scenario[index].id === "combined";
    const key = combined ? "net_worth" : "cash";
    const floor = first.baseline[index].cash_floor;
    const series = timelines.map((timeline) => timeline.lines[index][key]);
    if (series.some((values) => values?.length !== months.length)) {
      throw new Error("A projection is missing months needed to draw the image.");
    }
    const values = [...series.flatMap((points) => points ?? []), ...(floor === null ? [] : [floor])];
    const lower = Math.min(...values);
    const upper = Math.max(...values);
    const target = Math.max(1, (upper - lower) / 3);
    const magnitude = 10 ** Math.floor(Math.log10(target));
    const step = ([1, 2, 5, 10].find((n) => n * magnitude >= target) ?? 10) * magnitude;
    const min = Math.floor(lower / step) * step - (lower % step === 0 ? step : 0);
    const max = Math.ceil(upper / step) * step + (upper % step === 0 ? step : 0);
    const top = 173 + index * 228;
    const plotLeft = left + 112;
    const plotRight = right - 24;
    const plotTop = top + 57;
    const plotBottom = top + 185;
    const x = (i: number) => plotLeft + i * (plotRight - plotLeft) / Math.max(1, months.length - 1);
    const y = (val: number) => plotBottom - (val - min) * (plotBottom - plotTop) / (max - min);
    g.fillStyle = "#ffffff";
    g.fillRect(left, top, right - left, 211);
    text(combined ? "Combined net worth" : `${first.scenario[index].name}’s cash`, left + 21, top + 33, 27, ink, 650);
    for (let val = min; val <= max + step / 2; val += step) {
      line(plotLeft, y(val), plotRight, y(val), "#deebe3");
      text(chfShort(val), left + 20, y(val) + 5, 17, muted);
    }
    const years = months.flatMap((month, i) => month.endsWith("-01") ? [i] : []);
    const every = Math.max(1, Math.ceil(years.length / 9));
    for (const i of years.filter((_, pos) => pos % every === 0)) {
      line(x(i), plotTop, x(i), plotBottom, "#edf3ee");
      text(months[i].slice(0, 4), Math.min(x(i), plotRight - 40), plotBottom + 20, 16, muted);
    }
    if (floor !== null) {
      line(plotLeft, y(floor), plotRight, y(floor), "#ad6427", 2, [6, 6]);
      text(`Cash buffer ${chf(floor)}`, right - 265, top + 31, 18, "#794418", 600, 240);
    }
    for (const [i, timeline] of timelines.entries()) {
      const points = series[i]!;
      g.beginPath();
      g.strokeStyle = timeline.color;
      g.lineWidth = timeline.baseline ? 3 : 4;
      g.setLineDash(timeline.baseline ? [9, 7] : i > colors.length ? [14, 4] : []);
      points.forEach((value, month) => {
        if (month === 0) g.moveTo(x(month), y(value));
        else g.lineTo(x(month), y(value));
      });
      g.stroke();
      g.setLineDash([]);
    }
  }

  const tableY = 880;
  const metricX = [left + 650, left + 825, left + 1000];
  text("Compare the outcomes", left, tableY, 30, ink, 700);
  text("The two cash figures are each person’s lowest balance across the timeline.", left, tableY + 29, 19, muted);
  ["Path", `${first.baseline[0].name}’s low`, `${first.baseline[1].name}’s low`, "End net worth"].forEach((heading, i) =>
    text(heading, i === 0 ? left + 20 : metricX[i - 1], tableY + 64, 19, ink, 650, 158));
  timelines.forEach((timeline, i) => {
    const y = tableY + 79 + tableRow * i;
    g.fillStyle = i % 2 ? "#f8fbf9" : "#ffffff";
    g.fillRect(left, y, right - left, tableRow);
    line(left + 20, y + 27, left + 48, y + 27, timeline.color, 4, timeline.baseline ? [8, 5] : []);
    text(timeline.label, left + 62, y + 34, 21, ink, 650, 560);
    if (timeline.assumptions) text(timeline.assumptions, left + 62, y + 56, 17, muted, 400, 560);
    timeline.lines.forEach((value, j) => {
      const end = j === 2;
      const amount = end ? value.end_net_worth : value.minimum_cash;
      const base = end ? first.baseline[j].end_net_worth : first.baseline[j].minimum_cash;
      text(chf(amount), metricX[j], y + 32, 19, ink, 650, 149);
      const change = amount - base;
      if (!timeline.baseline) text(`${chf(change, { sign: true })} vs base`, metricX[j], y + 54, 15, change < 0 ? "#8d3e28" : muted, 400, 143);
      if (!end) text(monthLabel(value.minimum_cash_month), metricX[j], y + 72, 14, muted);
    });
  });
  text("Converge · Illustrative projections from the UBS synthetic demo. Values depend on the assumptions shown.", left, canvas.height - 21, 17, muted);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error("This browser could not export the comparison image."));
  }, "image/png"));
}
