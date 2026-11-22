"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight, ChartNoAxesCombined, FlaskConical, GraduationCap, House, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { cloneElement, useEffect, useId, useState, type FormEvent, type ReactElement } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { api } from "@/lib/api";
import { addMonths, chf, chfShort, monthLabel, pct } from "@/lib/format";
import { scopedHref, useStore } from "@/lib/store";
import type { Plan, ProgramId, WhatIfRequest, WhatIfResponse, WhatIfResult } from "@/lib/types";
import { Button, clsx } from "./ui";

const control = "mt-1.5 min-h-10 w-full rounded-lg border border-line-strong bg-white px-2.5 text-sm text-ink focus:border-accent focus:outline-none";
const panel = "rounded-2xl border border-line bg-white";
const defaultUncertainty = { inflation_spread: 0.015, investment_volatility: 0.1 };

function Field({ label, children }: { label: string; children: ReactElement<{ id?: string }> }) {
  const id = useId();
  return <div className="min-w-0">
    <label htmlFor={id} className="block text-xs font-medium text-ink-2">{label}</label>
    {cloneElement(children, { id })}
  </div>;
}

function Numeric({ label, value, min = 0, max, step = 1, onChange }: {
  label: string; value: string; min?: number; max: number; step?: number; onChange: (value: string) => void;
}) {
  return <Field label={label}>
    <input className={control} type="number" required min={min} max={max} step={step} value={value}
      onChange={(event) => onChange(event.target.value)} />
  </Field>;
}

export function ComparisonCards({ result, compact = false }: { result: WhatIfResult; compact?: boolean }) {
  return (
    <div className={clsx("grid gap-3", compact ? "sm:grid-cols-3" : "md:grid-cols-3")}>
      {result.scenario.map((after, i) => {
        const before = result.baseline[i];
        const combined = after.cash_floor === null;
        const change = combined ? (after.change_in_end_net_worth ?? after.end_net_worth - before.end_net_worth) :
          (after.change_in_minimum_cash ?? after.minimum_cash - before.minimum_cash);
        const Direction = change < 0 ? ArrowDownRight : ArrowUpRight;
        return <article key={after.id} className={clsx(panel, compact ? "p-3" : "p-4")}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className={clsx("size-2 rounded-full", i === 0 ? "bg-p0" : i === 1 ? "bg-p1" : "bg-shared")} />
            {after.name}
          </div>
          <p className="mt-3 text-xs text-muted">{combined ? "End net worth" : "Lowest monthly cash"}</p>
          <p className={clsx("tnum mt-1 font-semibold tracking-tight", compact ? "text-lg" : "text-2xl")}>
            {chf(combined ? after.end_net_worth : after.minimum_cash)}
          </p>
          <p className={clsx("mt-1 flex items-center gap-1 text-xs font-medium", change < -0.01 ? "text-bad" : change > 0.01 ? "text-good" : "text-muted")}>
            {Math.abs(change) >= 0.01 && <Direction size={13} />}
            {chf(change, { sign: true })} vs baseline
          </p>
          <p className="tnum mt-1 text-xs text-muted">Baseline {chf(combined ? before.end_net_worth : before.minimum_cash)}</p>
          {!combined && <p className={clsx("mt-3 border-t border-line pt-2 text-xs", (after.buffer_gap ?? 0) < -0.01 ? "text-bad-strong" : "text-muted")}>
            {chf(Math.abs(after.buffer_gap ?? 0))} {(after.buffer_gap ?? 0) < -0.01 ? "below" : "above"} buffer · {monthLabel(after.minimum_cash_month)}
          </p>}
        </article>;
      })}
    </div>
  );
}

function ComparisonChart({ result }: { result: WhatIfResult }) {
  const [index, setIndex] = useState(2);
  const [metric, setMetric] = useState<"cash" | "net_worth">("cash");
  const after = result.scenario[index];
  const before = result.baseline[index];
  const study = result.inputs.study;
  const rows = result.months?.map((month, i) => ({ month, Baseline: before[metric]?.[i], "What if": after[metric]?.[i] })) ?? [];
  const yearTicks = rows.filter((row) => row.month.endsWith("-01")).map((row) => row.month);
  return <section className={clsx(panel, "px-4 pb-4 pt-5 sm:px-5")} aria-label="Projected balances chart">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Projected balances</h2>
        <p className="mt-0.5 text-xs text-muted">{monthLabel(result.start)} to {monthLabel(result.end)} · nominal CHF</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Chart perspective" className="rounded-lg border border-line-strong bg-white px-2.5 py-2 text-sm" value={index} onChange={(event) => setIndex(Number(event.target.value))}>
          {result.scenario.map((line, i) => <option value={i} key={line.id}>{line.name}</option>)}
        </select>
        <select aria-label="Chart metric" className="rounded-lg border border-line-strong bg-white px-2.5 py-2 text-sm" value={metric} onChange={(event) => setMetric(event.target.value as typeof metric)}>
          <option value="cash">Cash</option><option value="net_worth">Net worth</option>
        </select>
      </div>
    </div>
    <div className="mt-4 h-64 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#e8eeeb" />
          <XAxis dataKey="month" ticks={yearTicks} tickFormatter={(v: string) => v.slice(0, 4)} minTickGap={30} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={chfShort} width={47} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
          {study && <ReferenceArea x1={study.start} x2={study.first_month_after_study > result.end ? result.end : study.first_month_after_study} fill="#30a58a" fillOpacity={0.13} />}
          {metric === "cash" && after.cash_floor !== null && <ReferenceLine y={after.cash_floor} stroke="#ad6237" strokeDasharray="2 4" ifOverflow="extendDomain" />}
          <Tooltip labelFormatter={(v) => monthLabel(String(v))} formatter={(v) => chf(typeof v === "number" ? v : null)} />
          <Line dataKey="What if" stroke="#0b785e" strokeWidth={3} dot={false} isAnimationActive={false} />
          <Line dataKey="Baseline" stroke="#6e7b81" strokeWidth={2} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      <span><span className="mr-1 inline-block w-4 border-t-2 border-dashed border-slate-500 align-middle" /> Baseline</span>
      <span><span className="mr-1 inline-block w-4 border-t-2 border-emerald-700 align-middle" /> What if</span>
      {metric === "cash" && after.cash_floor !== null && <span>· · · Cash buffer</span>}
      {study && <span><span className="mr-1 inline-block size-2.5 rounded-sm bg-emerald-100 align-middle" /> Study period</span>}
    </div>
    {metric === "net_worth" && after.net_worth_went_below_baseline && <p className="mt-3 text-xs text-muted">
      {after.net_worth_break_even_month ? `Net worth catches up in ${monthLabel(after.net_worth_break_even_month)} and stays at or above baseline through ${monthLabel(result.end)}.` :
        `Net worth ends below baseline in ${monthLabel(result.end)}.`}
    </p>}
  </section>;
}

function Risk({ result }: { result: WhatIfResult }) {
  const risk = result.risk;
  if (!risk) return null;
  const [low, median, high] = risk.paired_worth_delta;
  return <section className={clsx(panel, "p-5")}>
    <div className="flex items-center gap-2"><ShieldCheck size={19} className="text-emerald-700" /><h2 className="text-lg font-semibold tracking-tight">How sensitive is the result?</h2></div>
    <p className="mt-1 text-sm text-muted">Cash buffer breaches across {risk.trials} paired simulations.</p>
    <div className="mt-4 grid gap-2 sm:grid-cols-3">
      {result.scenario.map((line, i) => <div key={line.id} className="rounded-lg bg-page px-3 py-2">
        <p className="text-xs text-muted">{line.cash_floor === null ? "Either partner" : line.name}</p>
        <p className="tnum mt-1 text-sm font-semibold">{risk.baseline_breaches[i]} <span className="px-0.5 text-muted">→</span> {risk.scenario_breaches[i]} <span className="font-normal text-muted">/ {risk.trials}</span></p>
      </div>)}
    </div>
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-sm font-semibold">Combined end net worth</p>
      <p className="mt-1 text-xs text-muted">Middle 80% of simulated outcomes</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {[{ label: "Baseline", values: risk.baseline_worth }, { label: "What if", values: risk.scenario_worth }].map(({ label, values }) =>
          <div className="rounded-lg bg-page px-3 py-2" key={label}>
            <p className="text-xs text-muted">{label}</p>
            <p className="tnum mt-1 text-sm font-semibold">{chf(values[0], { compact: true })} to {chf(values[2], { compact: true })}</p>
          </div>)}
      </div>
      <p className="mt-3 text-sm">Across the same draws, the change versus baseline runs from <b>{chf(low, { sign: true })} to {chf(high, { sign: true })}</b> in the middle 80%, with a median of {chf(median, { sign: true })}.</p>
    </div>
    <details className="mt-3 text-xs leading-relaxed text-muted">
      <summary className="cursor-pointer font-medium text-ink-2">Uncertainty assumptions</summary>
      <p className="mt-2">Each pair shares the same shocks. Inflation varies uniformly by up to {pct(risk.inflation_spread, 1).replace("%", " percentage points")} for the entire projection, within model bounds. Monthly investment returns use a shared lognormal market factor with {pct(risk.investment_volatility, 1)} annualized volatility. Investment assets stay outside the cash buffer. These are illustrative assumptions. The counts describe this sample of model runs. Seed {risk.seed}.</p>
    </details>
  </section>;
}

export function WhatIfExplorer() {
  const { draftPlan, viewer } = useStore();
  if (!draftPlan) return null;
  return <Explorer key={viewer} plan={draftPlan} viewer={viewer} />;
}

function Explorer({ plan, viewer }: { plan: Plan; viewer: string }) {
  const { draft, ws, addChanges, setSourcesOpen } = useStore();
  const [catalogue, setCatalogue] = useState<Awaited<ReturnType<typeof api.whatIfCatalogue>>>();
  const [program, setProgram] = useState<ProgramId | "">("");
  const [student, setStudent] = useState(viewer || plan.people[0].id);
  const [studyStart, setStudyStart] = useState(addMonths(plan.assumptions.start, 8));
  const [studentPay, setStudentPay] = useState("30");
  const [fee, setFee] = useState("0");
  const [extraCost, setExtraCost] = useState("0");
  const [payDelta, setPayDelta] = useState("0");
  const [housing, setHousing] = useState<WhatIfRequest["housing"]["arrangement"]>(plan.shared.household.enabled ? "separate" : "together");
  const [move, setMove] = useState(plan.shared.household.move_in);
  const [rent, setRent] = useState(String(plan.shared.household.rent));
  const [split, setSplit] = useState(plan.shared.split.mode);
  const [firstShare, setFirstShare] = useState(String(plan.shared.split.custom_share_first * 100));
  const [adjust, setAdjust] = useState(plan.shared.split.adjust_for_breaks);
  const [purchase, setPurchase] = useState<NonNullable<WhatIfRequest["housing"]["purchase"]>>("keep");
  const [uncertainty, setUncertainty] = useState(true);
  const [inflation, setInflation] = useState(String(defaultUncertainty.inflation_spread * 100));
  const [volatility, setVolatility] = useState(String(defaultUncertainty.investment_volatility * 100));
  const [last, setLast] = useState<{ result: WhatIfResponse; input: string }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const selected = program ? catalogue?.programs[program] : undefined;
  const choice: WhatIfRequest = {
    study: selected && program ? {
      person: student, program, start: studyStart, income_pct: Number(studentPay),
      semester_fee_chf: Number(fee), extra_cost_chf: Number(extraCost), monthly_pay_delta: Number(payDelta),
    } : undefined,
    housing: housing === "together" ? {
      arrangement: housing, move_in: move, rent: Number(rent), split,
      first_share: split === "custom" ? Number(firstShare) / 100 : undefined, adjust_for_breaks: adjust, purchase,
    } : { arrangement: housing, purchase: housing === "separate" ? "exclude" : purchase },
    uncertainty: uncertainty ? { inflation_spread: Number(inflation) / 100, investment_volatility: Number(volatility) / 100 } : undefined,
  };
  const snapshot = JSON.stringify([choice, draft, ws?.versions[0]?.id]);
  const [initial] = useState(() => ({ choice, draft, snapshot }));
  const result = last?.result;
  const stale = !!last && last.input !== snapshot;
  const end = addMonths(plan.assumptions.start, plan.assumptions.horizon_months - 1);

  useEffect(() => {
    let live = true;
    void api.whatIfCatalogue().then((data) => { if (live) setCatalogue(data); }).catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void api.whatIf(initial.choice, initial.draft, controller.signal).then((comparison) => {
      if (!controller.signal.aborted) setLast({ result: comparison, input: initial.snapshot });
    }).catch((problem: Error) => {
      if (!controller.signal.aborted) setError(problem.message);
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [initial]);

  async function run(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setLast({ result: await api.whatIf(choice, draft), input: snapshot });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The comparison failed.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="mt-5 sm:mt-8">
    <header className="relative isolate overflow-hidden rounded-[24px] bg-[#122e2a] px-6 py-8 text-white sm:px-9 sm:py-10">
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-3/5 bg-[radial-gradient(ellipse_at_top_right,#27594b,transparent_72%)]" />
      <div aria-hidden className="pointer-events-none absolute -right-14 -top-24 -z-10 hidden size-[420px] rounded-full border border-emerald-200/15 sm:block" />
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 -z-10 hidden size-[500px] rounded-full border border-emerald-200/10 sm:block" />
      <p className="flex items-center gap-2 text-xs font-medium text-emerald-200"><FlaskConical size={15} /> What-if explorer</p>
      <h1 className="mt-3 max-w-2xl text-[clamp(2rem,5vw,3.5rem)] leading-[1.04] font-semibold tracking-[-0.055em]">What could you change together?</h1>
      <p className="mt-4 max-w-lg text-sm leading-relaxed text-emerald-50/80 sm:text-base">Try a life decision against your current plan. See what changes for each of you and what it means for your shared future.</p>
    </header>

    <div className="mt-6 grid items-start gap-5 lg:grid-cols-[310px_minmax(0,1fr)]">
      <form onSubmit={run} className={clsx(panel, "space-y-5 p-5")}>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Build a scenario</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">Compare with {draft.length ? "your current draft" : "your agreed plan"}.</p>
        </div>
        <fieldset className="space-y-3 border-t border-line pt-4">
          <legend className="flex items-center gap-2 pr-2 text-sm font-semibold"><House size={16} className="text-accent" /> Living arrangement</legend>
          <Field label="Housing choice">
            <select className={control} value={housing} onChange={(e) => setHousing(e.target.value as typeof housing)}>
              <option value="current">Keep current arrangement</option><option value="together">Live together</option><option value="separate">Live separately</option>
            </select>
          </Field>
          {housing === "separate" && plan.shared.property.enabled && <p className="text-xs leading-relaxed text-muted">This scenario also switches off the planned joint purchase.</p>}
          {housing === "together" && <>
            <Field label="Move-in month"><input className={control} type="month" required value={move} onChange={(e) => setMove(e.target.value)} /></Field>
            <Numeric label="Shared rent (CHF/month)" value={rent} max={50_000} step={0.01} onChange={setRent} />
            <Field label="Split shared costs">
              <select className={control} value={split} onChange={(e) => setSplit(e.target.value as typeof split)}>
                <option value="equal">Equally</option><option value="income">By usual income</option><option value="custom">Custom split</option>
              </select>
            </Field>
            {split === "custom" && <Numeric label={`${plan.people[0].name}’s share (%)`} value={firstShare} max={100} step={0.1} onChange={setFirstShare} />}
            <label className="flex items-start gap-2 text-xs text-muted"><input type="checkbox" className="mt-0.5 accent-emerald-700" checked={adjust} onChange={(e) => setAdjust(e.target.checked)} /> Split by actual income during leave or study</label>
          </>}
          {housing !== "separate" && <>
            <Field label="Joint home purchase">
              <select className={control} value={purchase} onChange={(e) => setPurchase(e.target.value as typeof purchase)}>
                <option value="keep">Keep current choice</option><option value="include">Buy the planned home</option><option value="exclude">Exclude the purchase</option>
              </select>
            </Field>
            {(purchase === "include" || (purchase === "keep" && plan.shared.property.enabled)) && <p className="text-xs text-muted">{chf(plan.shared.property.price)} · {monthLabel(plan.shared.property.purchase)} · <Link className="underline" href={scopedHref("/goals", "together")}>Edit home assumptions</Link></p>}
          </>}
        </fieldset>
        <fieldset className="space-y-3 border-t border-line pt-4">
          <legend className="flex items-center gap-2 pr-2 text-sm font-semibold"><GraduationCap size={16} className="text-accent" /> Education</legend>
          <Field label="Programme">
            <select className={control} value={program} disabled={!catalogue} onChange={(e) => {
              const next = e.target.value as ProgramId | "";
              setProgram(next);
              if (next) setFee(String(catalogue?.programs[next].semester_fee_chf ?? 0));
            }}>
              <option value="">No new studies</option>
              {catalogue && Object.entries(catalogue.programs).map(([id, course]) => <option value={id} key={id}>{course.label}</option>)}
            </select>
          </Field>
          {!catalogue && <p className="text-xs text-muted">Education options are unavailable until the catalogue loads.</p>}
          {selected && <>
            <p className="text-xs text-muted">{selected.school} · {selected.semesters} semesters · <a className="underline" href={selected.source} target="_blank" rel="noreferrer">Programme source</a>{selected.fees_source && <> · <a className="underline" href={selected.fees_source} target="_blank" rel="noreferrer">Fees</a></>}</p>
            <Field label="Who studies?"><select className={control} value={student} onChange={(e) => setStudent(e.target.value)}>{plan.people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></Field>
            <Field label="Study starts"><input className={control} type="month" required min={plan.assumptions.start} max={end} value={studyStart} onChange={(e) => setStudyStart(e.target.value)} /></Field>
            <Numeric label="Usual net pay kept while studying (%)" value={studentPay} max={100} step={0.1} onChange={setStudentPay} />
            <Numeric label="Fees per semester (CHF)" value={fee} max={100_000} step={0.01} onChange={setFee} />
            <Numeric label="Extra upfront study costs (CHF)" value={extraCost} max={100_000} step={0.01} onChange={setExtraCost} />
            <Numeric label="Net pay change after study (CHF/month)" value={payDelta} min={-50_000} max={50_000} onChange={setPayDelta} />
            <p className="text-xs leading-relaxed text-muted">The starting 30% pay while studying is illustrative. Try your own take-home pay assumptions. The <a className="underline" href={catalogue?.graduate_survey} target="_blank" rel="noreferrer">Federal Statistical Office survey</a> shows how gross earnings vary by field for applied-sciences bachelor graduates.</p>
          </>}
        </fieldset>
        <div className="space-y-3 border-t border-line pt-4">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="accent-emerald-700" checked={uncertainty} onChange={(e) => setUncertainty(e.target.checked)} /> Include uncertainty</label>
          {uncertainty && <details className="text-xs text-muted">
            <summary className="cursor-pointer">Edit uncertainty inputs</summary>
            <div className="mt-2 space-y-3">
              <Numeric label="Inflation range (± percentage points)" value={inflation} max={10} step={0.1} onChange={setInflation} />
              <Numeric label="Annual investment volatility (%)" value={volatility} max={50} step={0.1} onChange={setVolatility} />
            </div>
          </details>}
          <Button variant="primary" className="w-full justify-center bg-[#146b57] hover:bg-[#0f5143]" type="submit" disabled={busy}>
            {busy ? "Comparing…" : "Run comparison"} <ArrowRight size={15} />
          </Button>
          {error && <p role="alert" className="text-sm text-bad-strong">{error}</p>}
        </div>
      </form>

      <div className="min-w-0 space-y-4" aria-busy={busy}>
        {!result ? <div className={clsx(panel, "grid min-h-64 place-items-center p-8 text-center text-sm text-muted")}><div><ChartNoAxesCombined className="mx-auto mb-3 text-accent" size={25} />{busy ? "Running the first comparison…" : "Run a comparison to see both paths."}</div></div> : <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Impact at a glance</h2>
            <span role="status" className={clsx("text-xs", stale ? "text-warn" : "text-muted")}>{stale ? "Inputs changed · run again to update" : "Baseline compared with what-if"}</span>
          </div>
          <ComparisonCards result={result} />
          <ComparisonChart result={result} />
          <Risk result={result} />
          <details className={clsx(panel, "px-5 py-4 text-sm")}>
            <summary className="cursor-pointer font-semibold">What went into this comparison?</summary>
            <div className="mt-3 space-y-2 leading-relaxed text-muted">
              {result.inputs.study && <p>{result.inputs.study.name} starts {result.inputs.study.program} in {monthLabel(result.inputs.study.start)}, keeps {result.inputs.study.income_pct}% of usual pay, pays {chf(result.inputs.study.semester_fee_chf)} every six months during study and {chf(result.inputs.study.extra_cost_chf)} up front. Net pay changes by {chf(result.inputs.study.monthly_pay_delta, { sign: true })}/month from {monthLabel(result.inputs.study.first_month_after_study)}.</p>}
              {result.inputs.scenario_housing.enabled ? <p>Shared rent of {chf(result.inputs.scenario_housing.rent)}/month starts from {monthLabel(result.inputs.scenario_housing.move_in)}, with shared costs split {result.inputs.scenario_split.mode === "equal" ? "equally" : result.inputs.scenario_split.mode === "income" ? "by usual income" : `with ${pct(result.inputs.scenario_split.custom_share_first, 1)} paid by ${result.scenario[0].name}`}{result.inputs.scenario_split.adjust_for_breaks ? ", adjusted to actual income during leave or study" : ""}.</p> : <p>The shared rental household is off. {result.inputs.scenario_home_purchase_enabled ? "A joint purchase can still trigger cohabitation." : "Each partner keeps their own housing and ordinary living costs."}</p>}
              {result.inputs.scenario_home_purchase && <p>A joint purchase of {chf(result.inputs.scenario_home_purchase.price)} in {monthLabel(result.inputs.scenario_home_purchase.month)} can move cohabitation earlier and replaces shared rent upon purchase.</p>}
              <p>Combined cash adds the two balances for the same month. Either partner can fall below their cash buffer even when total cash is positive.</p>
              <p>{result.checks_passed ? "Cash, net-worth and transfer identities passed." : "An accounting check failed."}</p>
              {result.issues.length > 0 && <ul className="list-disc pl-5">{result.issues.map((issue, index) => <li key={index}>{issue.title}</li>)}</ul>}
              <button type="button" onClick={() => setSourcesOpen(true)} className="font-medium text-accent underline">Open model assumptions and sources</button>
            </div>
          </details>
          {!stale && result.checks_passed && result.draft_changes.length > 0 && <Button onClick={() => addChanges(result.draft_changes)}>Add scenario to draft <ArrowRight size={15} /></Button>}
        </>}
      </div>
    </div>
  </div>;
}
