"use client";

import { ArrowRight, Briefcase, CornerDownLeft, FileText, Gauge, Home, Loader2, MessageSquareText, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";

import { CashChart, ChartLegend } from "@/components/charts/CashChart";
import { ChangeRow } from "@/components/DraftBar";
import { IssueCard } from "@/components/IssueCard";
import { Recommendations } from "@/components/Recommendations";
import { Avatar, Badge, Button, Card, CardHeader, Delta, MonthField, NumberField, Range, Segmented, StatusPill, clsx } from "@/components/ui";
import { api } from "@/lib/api";
import { chf, monthLabel, pct } from "@/lib/format";
import { useDisplayed, useStore } from "@/lib/store";
import type { CareerBreak, ExplainResponse, InterpretResponse } from "@/lib/types";

const EXAMPLES = [
  "I want to take six months off next year, but we still want to buy a house before 2030",
  "What if the mortgage rate rises to 3.5%?",
  "Buy a CHF 1.2M home in Oct 2028",
];

function Assistant() {
  const { viewer, draft, addChanges, ws, toast } = useStore();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<InterpretResponse | null>(null);
  const run = async (t: string) => {
    if (!t.trim()) return;
    setBusy(true);
    try {
      setRes(await api.interpret(t, viewer, draft));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader icon={<MessageSquareText size={17} />} title="Describe a decision"
        subtitle={ws?.llm_available ? "Claude turns your words into structured changes. The engine does every calculation." : "No language model configured — a built-in rule-based parser handles common phrasings."} />
      <div className="px-5 pb-5">
        <form onSubmit={(e) => { e.preventDefault(); run(text); }} className="relative">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Describe a decision"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(text); } }}
            placeholder="e.g. Emil takes six months off from January 2028…"
            className="w-full resize-none rounded-xl border border-line-strong bg-white px-3.5 py-2.5 pr-12 text-[13.5px] outline-none placeholder:text-subtle focus:ring-2 focus:ring-accent/30" />
          <button type="submit" disabled={busy || !text.trim()} aria-label="Interpret" className="absolute right-2.5 bottom-3 flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-white disabled:opacity-40">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <CornerDownLeft size={15} />}
          </button>
        </form>
        {!res && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLES.map((e) => (
              <button key={e} onClick={() => { setText(e); run(e); }} className="rounded-full bg-page px-2.5 py-1 text-left text-[12px] text-ink-2 ring-1 ring-line hover:bg-line/60">{e}</button>
            ))}
          </div>
        )}
        {res && (
          <div className="fade-up mt-3 rounded-xl bg-page p-3.5 ring-1 ring-line">
            <div className="mb-1.5 flex items-center gap-2">
              <Badge tone={res.mode === "llm" ? "info" : "neutral"}>{res.mode === "llm" ? <><Sparkles size={11} /> Interpreted by Claude</> : "Offline parser"}</Badge>
              <span className="text-[11.5px] text-muted">validated against the plan schema</span>
            </div>
            {res.mode === "llm" && <p className="text-[13px] text-ink-2">{res.summary}</p>}
            {res.notice && <p className="mt-1 text-[12px] text-warn">{res.notice}</p>}
            {res.described.length > 0 && <div className="mt-1 divide-y divide-line">{res.described.map((c) => <ChangeRow key={c.path} c={c} />)}</div>}
            {res.clarification && <p className="mt-2 text-[12.5px] text-warn">{res.clarification}</p>}
            {res.rejected.length > 0 && <p className="mt-2 text-[11.5px] text-muted">Ignored {res.rejected.length} unsupported item(s).</p>}
            <div className="mt-3 flex gap-2">
              {res.changes.length > 0 && <Button size="sm" variant="primary" onClick={() => { addChanges(res.changes); setRes(null); setText(""); }}>Add to scenario</Button>}
              <Button size="sm" variant="ghost" onClick={() => setRes(null)}>Clear</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function QuickDecisions() {
  const { draftPlan, addChanges, setChange, viewer, ws } = useStore();
  const [whoSel, setWho] = useState<string | null>(null);
  const who = whoSel ?? viewer;
  const [start, setStart] = useState("2028-01");
  const [months, setMonths] = useState(6);
  const [incomePct, setIncomePct] = useState(0);
  const [cost, setCost] = useState(8000);
  if (!draftPlan || !ws) return null;
  const pr = draftPlan.shared.property;
  const buying = pr.enabled;
  const person = draftPlan.people.find((p) => p.id === who) ?? draftPlan.people[0];
  const addBreak = () => {
    // One break per person in the quick form: replaces any existing break (overlaps are invalid).
    const list: CareerBreak[] = [{ id: person.career_breaks[0]?.id ?? "cb1", start, months, income_pct: incomePct, one_off_cost_chf: cost, label: "Career break" }];
    setChange(`people.${person.id}.career_breaks`, list);
  };
  return (
    <Card>
      <CardHeader title="Try a decision" subtitle="Each one is added to your scenario and simulated instantly." />
      <div className="space-y-3 px-5 pb-5">
        <div className="rounded-xl border border-line p-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Home size={16} className="text-muted" />
              <div>
                <div className="text-[13.5px] font-medium">Buy a home together</div>
                <div className="text-[12px] text-muted">{chf(pr.price, { compact: true })} · {pct(pr.deposit_pct)} deposit · {monthLabel(pr.purchase)}</div>
              </div>
            </div>
            <Button size="sm" variant={buying ? "subtle" : "primary"} disabled={buying}
              onClick={() => addChanges([{ path: "shared.household.enabled", value: true }, { path: "shared.property.enabled", value: true }])}>
              {buying ? "Included" : "Add"}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-line p-3.5">
          <div className="flex items-center gap-2.5">
            <Briefcase size={16} className="text-muted" />
            <div className="text-[13.5px] font-medium">Career break</div>
          </div>
          <div className="mt-3 space-y-2.5">
            <Segmented size="sm" ariaLabel="Who takes the break" value={person.id} onChange={setWho}
              options={ws.people.map((p, i) => ({ value: p.id, label: <span className="flex items-center gap-1.5"><Avatar name={p.name} index={i} size={16} />{p.name}</span> }))} />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11.5px] font-medium text-muted">From<div className="mt-1"><MonthField ariaLabel="Break start" value={start} min={draftPlan.assumptions.start} onChange={setStart} /></div></label>
              <label className="text-[11.5px] font-medium text-muted">Months<div className="mt-1"><NumberField ariaLabel="Break months" value={months} step={1} min={1} max={36} prefix="" width="100%" onChange={setMonths} /></div></label>
              <label className="text-[11.5px] font-medium text-muted">Income kept<div className="mt-1"><NumberField ariaLabel="Income kept percent" value={incomePct} step={10} min={0} max={100} prefix="" suffix="%" width="100%" onChange={setIncomePct} /></div></label>
              <label className="text-[11.5px] font-medium text-muted">Costs<div className="mt-1"><NumberField ariaLabel="Break costs" value={cost} step={1000} width="100%" onChange={setCost} /></div></label>
            </div>
            <Button size="sm" variant="primary" className="w-full" onClick={addBreak}>{person.career_breaks.length ? `Update ${person.name}'s break` : `Add ${person.name}'s break`}</Button>
          </div>
        </div>

        <div className="rounded-xl border border-line p-3.5">
          <div className="flex items-center gap-2.5">
            <Gauge size={16} className="text-muted" />
            <div className="text-[13.5px] font-medium">Stress test</div>
          </div>
          <div className="mt-3 space-y-3">
            <div>
              <div className="flex justify-between text-[12.5px]"><span className="text-muted">Mortgage rate</span><span className="tnum font-semibold">{pct(pr.mortgage_rate, 2)}</span></div>
              <div className="mt-1.5"><Range ariaLabel="Mortgage rate" value={Math.round(pr.mortgage_rate * 1000) / 10} min={0.5} max={6} step={0.1} onChange={(v) => setChange("shared.property.mortgage_rate", Number((v / 100).toFixed(4)))} /></div>
            </div>
            <div>
              <div className="flex justify-between text-[12.5px]"><span className="text-muted">Inflation</span><span className="tnum font-semibold">{pct(draftPlan.assumptions.expense_inflation, 1)}</span></div>
              <div className="mt-1.5"><Range ariaLabel="Inflation" value={Math.round(draftPlan.assumptions.expense_inflation * 1000) / 10} min={0} max={5} step={0.1} onChange={(v) => setChange("assumptions.expense_inflation", Number((v / 100).toFixed(4)))} /></div>
            </div>
            <div>
              <div className="flex justify-between text-[12.5px]"><span className="text-muted">Investment return</span><span className="tnum font-semibold">{pct(draftPlan.assumptions.investment_return, 1)}</span></div>
              <div className="mt-1.5"><Range ariaLabel="Investment return" value={Math.round(draftPlan.assumptions.investment_return * 1000) / 10} min={-10} max={8} step={0.5} onChange={(v) => setChange("assumptions.investment_return", Number((v / 100).toFixed(4)))} /></div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ScenarioList() {
  const { sim, draft, removeChange, discardDraft } = useStore();
  if (!draft.length) return null;
  return (
    <Card>
      <CardHeader title="Your scenario" subtitle="Changes against the agreed plan" action={<Button size="sm" variant="ghost" onClick={discardDraft}>Clear</Button>} />
      <div className="divide-y divide-line px-5 pb-3">
        {(sim?.changes ?? []).map((c) => <ChangeRow key={c.path} c={c} onRemove={() => removeChange(c.path)} />)}
      </div>
    </Card>
  );
}

function Explain() {
  const { draft } = useStore();
  const [res, setRes] = useState<ExplainResponse | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      {!res ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={async () => { setBusy(true); try { setRes(await api.explain(draft)); } finally { setBusy(false); } }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Summarise in plain words
        </Button>
      ) : (
        <div className="fade-up rounded-xl bg-page p-3.5 text-[13px] leading-5 text-ink-2 ring-1 ring-line">
          <div className="mb-1.5 flex items-center gap-2">
            <Badge tone={res.mode === "llm" ? "info" : "neutral"}>{res.mode === "llm" ? <><Sparkles size={11} /> Written by Claude</> : "Engine summary"}</Badge>
            <span className="flex items-center gap-1 text-[11.5px] text-good"><ShieldCheck size={12} /> every number checked against the engine</span>
          </div>
          {res.text}
          {res.notice && <p className="mt-1.5 text-[11.5px] text-muted">{res.notice}</p>}
          <button onClick={() => setRes(null)} className="mt-1.5 block text-[12px] font-medium text-accent">Close</button>
        </div>
      )}
    </div>
  );
}

function Comparison() {
  const { draft, preview } = useStore();
  const { current, base } = useDisplayed();
  if (!current || !base) return null;
  const changed = draft.length > 0 || !!preview;
  return (
    <Card>
      <CardHeader
        title={changed ? (preview ? `Preview: ${preview.label}` : "Agreed plan vs. this scenario") : "Your agreed plan"}
        subtitle={changed ? "Solid lines: scenario. Dashed: agreed plan." : "Add a decision on the left to see how it changes each partner's future."}
        action={<div className="flex items-center gap-2">{changed && <><StatusPill status={base.status} size="sm" /><ArrowRight size={13} className="text-subtle" /></>}<StatusPill status={current.status} size="sm" /></div>}
      />
      <div className="px-2 sm:px-4"><CashChart current={current} base={changed ? base : null} height={300} compareLabel="Agreed plan" /></div>
      <div className="px-5 pt-1 pb-4 sm:px-6"><ChartLegend names={current.people.map((p) => p.name)} showBase={changed} showBreak={current.events.some((e) => e.kind === "career_break")} /></div>
      <div className="grid gap-px border-t border-line bg-line sm:grid-cols-2">
        {current.people.map((p, i) => {
          const b = base.people[i];
          return (
            <div key={p.id} className="bg-white px-5 py-4">
              <div className="mb-3 flex items-center gap-2 text-[13.5px] font-semibold"><Avatar name={p.name} index={i} size={22} />{p.name}</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[12.5px]">
                {[
                  { l: "Lowest cash", v: p.min_cash, bv: b.min_cash, bad: p.breach, sub: monthLabel(p.min_cash_month) },
                  { l: "Cushion above minimum", v: p.headroom, bv: b.headroom, bad: p.headroom < 0 },
                  { l: "Cash at end", v: p.end_cash, bv: b.end_cash },
                  { l: "Net worth at end", v: p.end_net_worth, bv: b.end_net_worth },
                ].map((m) => (
                  <div key={m.l}>
                    <div className="text-muted">{m.l}</div>
                    <div className={clsx("tnum text-[15px] font-semibold", m.bad ? "text-bad-strong" : "text-ink")}>{chf(m.v, { compact: true })}</div>
                    {changed ? <Delta before={m.bv} after={m.v} /> : m.sub ? <span className="text-[12px] text-muted">{m.sub}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {current.issues.length > 0 && (
        <div className="grid gap-3 border-t border-line p-4 md:grid-cols-2">
          {current.issues.map((x) => <IssueCard key={x.id} issue={x} />)}
        </div>
      )}
      <div className="border-t border-line px-4 py-3"><Explain /></div>
    </Card>
  );
}

export function Explore() {
  return (
    <div className="fade-up space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Scenarios</h1>
        <p className="mt-1 text-[13.5px] text-muted">Try a decision, see its consequences for each of you, and find a version of the plan that works for both.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-6">
          <ScenarioList />
          <QuickDecisions />
          <Assistant />
        </div>
        <div className="min-w-0 space-y-6">
          <Comparison />
        </div>
      </div>
      <Recommendations />
    </div>
  );
}
