"use client";

import * as Popover from "@radix-ui/react-popover";
import { Briefcase, CornerDownLeft, Gauge, Home, Loader2, Sparkles, X } from "lucide-react";
import { useState } from "react";

import { api, llmProviderLabel } from "@/lib/api";
import { pct } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { InterpretResponse } from "@/lib/types";
import { ChangeRow } from "./DraftBar";
import { Avatar, Button, MonthField, NumberField, Range, Segmented, clsx } from "./ui";

const chip = "inline-flex h-10 items-center gap-2 rounded-full border border-line-strong bg-white px-4 text-[13.5px] font-medium text-ink shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-colors hover:bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

function Pop({ trigger, children, width = 320 }: { trigger: React.ReactNode; children: (close: () => void) => React.ReactNode; width?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={8} collisionPadding={12} className="z-50 rounded-2xl border border-line bg-white p-5 shadow-xl" style={{ width }}>
          {children(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CareerBreakForm({ close }: { close: () => void }) {
  const { draftPlan, viewer, setChange } = useStore();
  const [who, setWho] = useState(viewer);
  const [start, setStart] = useState("2028-01");
  const [months, setMonths] = useState(6);
  const [income, setIncome] = useState(0);
  const [cost, setCost] = useState(8000);
  if (!draftPlan) return null;
  const person = draftPlan.people.find((p) => p.id === who) ?? draftPlan.people[0];
  return (
    <div className="space-y-4">
      <div className="text-[15px] font-semibold">Career break</div>
      <Segmented ariaLabel="Who takes the break" value={person.id} onChange={setWho}
        options={draftPlan.people.map((p, i) => ({ value: p.id, label: <span className="flex items-center gap-1.5"><Avatar name={p.name} index={i} size={16} />{p.name}</span> }))} />
      <div className="grid grid-cols-2 gap-3 text-[12px] text-muted">
        <label>From<div className="mt-1"><MonthField ariaLabel="Break start" value={start} min={draftPlan.assumptions.start} onChange={setStart} /></div></label>
        <label>Length<div className="mt-1"><NumberField ariaLabel="Break months" value={months} min={1} max={36} step={1} prefix="" suffix="mo" width="100%" onChange={setMonths} /></div></label>
        <label>Income kept<div className="mt-1"><NumberField ariaLabel="Income kept" value={income} min={0} max={100} step={10} prefix="" suffix="%" width="100%" onChange={setIncome} /></div></label>
        <label>One-off costs<div className="mt-1"><NumberField ariaLabel="Break costs" value={cost} step={1000} width="100%" onChange={setCost} /></div></label>
      </div>
      <Button variant="primary" className="w-full" onClick={() => {
        setChange(`people.${person.id}.career_breaks`, [{ id: person.career_breaks[0]?.id ?? "cb1", start, months, income_pct: income, one_off_cost_chf: cost, label: "Career break" }]);
        close();
      }}>{person.career_breaks.length ? "Update" : "Add"} {person.name}&apos;s break</Button>
    </div>
  );
}

function StressForm() {
  const { draftPlan, setChange } = useStore();
  if (!draftPlan) return null;
  const pr = draftPlan.shared.property;
  const a = draftPlan.assumptions;
  const rows = [
    { label: "Mortgage rate", v: pr.mortgage_rate, min: 0.5, max: 6, step: 0.1, path: "shared.property.mortgage_rate", digits: 2, disabled: !pr.enabled },
    { label: "Inflation", v: a.expense_inflation, min: 0, max: 5, step: 0.1, path: "assumptions.expense_inflation", digits: 1 },
    { label: "Investment return", v: a.investment_return, min: -10, max: 8, step: 0.5, path: "assumptions.investment_return", digits: 1 },
  ];
  return (
    <div className="space-y-4">
      <div className="text-[15px] font-semibold">Stress test</div>
      {rows.map((r) => (
        <div key={r.path} className={clsx(r.disabled && "opacity-40")}>
          <div className="flex justify-between text-[13px]"><span className="text-muted">{r.label}</span><span className="tnum font-semibold">{pct(r.v, r.digits)}</span></div>
          <div className="mt-2"><Range ariaLabel={r.label} value={Math.round(r.v * 1000) / 10} min={r.min} max={r.max} step={r.step} onChange={(v) => !r.disabled && setChange(r.path, Number((v / 100).toFixed(4)))} /></div>
        </div>
      ))}
      {!pr.enabled && <p className="text-[12px] text-muted">Add a home purchase to stress the mortgage rate.</p>}
    </div>
  );
}

function Ask() {
  const { viewer, draft, addChanges, toast } = useStore();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<InterpretResponse | null>(null);
  const run = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      setRes(await api.interpret(text, viewer, draft));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover.Root open={!!res} onOpenChange={(o) => !o && setRes(null)}>
      <Popover.Anchor asChild>
        <form onSubmit={(e) => { e.preventDefault(); run(); }} className="relative min-w-0 flex-1 basis-[260px]">
          <Sparkles size={15} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-accent" />
          <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Describe a change in your own words"
            placeholder="Describe a change, e.g. “Emil takes 12 months off from Jan 2028”"
            className="h-10 w-full rounded-full border border-line-strong bg-white pr-11 pl-9 text-[13.5px] outline-none placeholder:text-subtle focus:ring-2 focus:ring-accent/30" />
          <button type="submit" aria-label="Interpret" disabled={busy || !text.trim()} className="absolute top-1/2 right-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-white disabled:opacity-30">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <CornerDownLeft size={13} />}
          </button>
        </form>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={8} collisionPadding={12} className="z-50 w-[min(420px,calc(100vw-24px))] rounded-2xl border border-line bg-white p-5 shadow-xl">
          {res && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-muted">{res.mode === "llm" && res.provider ? `Understood by ${llmProviderLabel[res.provider]} · checked by the engine` : "Understood by the built-in parser"}</span>
                <button aria-label="Close" onClick={() => setRes(null)} className="text-subtle hover:text-ink"><X size={15} /></button>
              </div>
              {res.notice && <p className="mt-1 text-[12px] text-warn">{res.notice}</p>}
              {res.described.length > 0 ? (
                <div className="mt-2 divide-y divide-line">{res.described.map((c) => <ChangeRow key={c.path} c={c} />)}</div>
              ) : null}
              {res.clarification && <p className="mt-2 text-[13px] text-warn">{res.clarification}</p>}
              {res.changes.length > 0 && (
                <Button variant="primary" className="mt-4 w-full" onClick={() => { addChanges(res.changes); setRes(null); setText(""); }}>Try this</Button>
              )}
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function Decisions() {
  const { draftPlan, addChanges, openSheet } = useStore();
  if (!draftPlan) return null;
  const buying = draftPlan.shared.property.enabled;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className={chip} onClick={() => {
        if (!buying) addChanges([{ path: "shared.household.enabled", value: true }, { path: "shared.property.enabled", value: true }]);
        openSheet({ kind: "shared" });
      }}>
        <Home size={16} className="text-muted" /> {buying ? "Home purchase" : "Buy a home"}
      </button>
      <Pop trigger={<button className={chip}><Briefcase size={16} className="text-muted" /> Career break</button>}>
        {(close) => <CareerBreakForm close={close} />}
      </Pop>
      <Pop trigger={<button className={chip}><Gauge size={16} className="text-muted" /> Stress test</button>} width={300}>
        {() => <StressForm />}
      </Pop>
      <Ask />
    </div>
  );
}
