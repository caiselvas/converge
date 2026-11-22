"use client";

import * as Popover from "@radix-ui/react-popover";
import { Baby, Briefcase, ChevronRight, Gauge, Home, KeyRound, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { chf, monthLabel, pct } from "@/lib/format";
import { scopedHref, useStore } from "@/lib/store";
import type { Stress } from "@/lib/types";
import { decisionHref } from "./decisions/registry";
import { Range, clsx } from "./ui";

const chip = "inline-flex min-h-10 items-center gap-2 rounded-xl border border-line-strong bg-white px-3.5 text-[14px] font-medium text-ink hover:bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

const stressFields = [
  { key: "income_drop", label: "Income drop", short: "income drop", min: 0, max: 50, step: 1 },
  { key: "mortgage_rate", label: "Mortgage rate", short: "mortgage", min: 0.5, max: 6, step: 0.1 },
  { key: "expense_inflation", label: "Inflation", short: "inflation", min: 0, max: 5, step: 0.1 },
  { key: "investment_return", label: "Investment return", short: "investment return", min: -10, max: 8, step: 0.5 },
] as const;

function Pop({ trigger, children }: { trigger: React.ReactNode; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={8} collisionPadding={12} className="z-50 max-h-[var(--radix-popover-content-available-height)] w-[min(340px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-line bg-white p-4 shadow-xl">
          {children(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function StressForm({ mortgageRate }: { mortgageRate?: number | null }) {
  const { draftPlan, stress, setStress } = useStore();
  if (!draftPlan) return null;
  const property = draftPlan.shared.property;
  const rate = mortgageRate === undefined ? (property.enabled ? property.mortgage_rate : null) : mortgageRate;
  const defaults: Required<Stress> = {
    income_drop: 0,
    mortgage_rate: rate ?? property.mortgage_rate,
    expense_inflation: draftPlan.assumptions.expense_inflation,
    investment_return: draftPlan.assumptions.investment_return,
  };
  return (
    <div className="space-y-4">
      <div className="text-[15px] font-semibold">Stress test</div>
      {stressFields.map(({ key, label, min, max, step }) => {
        const value = stress[key] ?? defaults[key];
        const disabled = key === "mortgage_rate" && rate === null;
        return (
          <div key={key} className={clsx(disabled && "opacity-40")}>
            <div className="flex justify-between text-[13px]"><span className="text-muted">{label}</span><span className="tnum font-semibold">{pct(value, 1)}</span></div>
            <div className="mt-2">
              <Range ariaLabel={label} value={Math.round(value * 1000) / 10} min={min} max={max} step={step} onChange={(v) => {
                if (disabled) return;
                const rate = Number((v / 100).toFixed(4));
                const next = { ...stress };
                if (rate === defaults[key]) delete next[key];
                else next[key] = rate;
                setStress(next);
              }} />
            </div>
          </div>
        );
      })}
      {rate === null && <p className="text-[12px] text-muted">Add a home purchase to stress the mortgage rate.</p>}
    </div>
  );
}

export function StressButton({ mortgageRate }: { mortgageRate?: number | null }) {
  return <Pop trigger={<button className={chip}><Gauge size={16} className="text-muted" /> Stress test</button>}>
    {() => <StressForm mortgageRate={mortgageRate} />}
  </Pop>;
}

export function StressTag() {
  const { stress, setStress } = useStore();
  const active = stressFields.filter(({ key }) => stress[key] !== undefined);
  if (!active.length) return null;
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-warn-soft px-2.5 text-[12px] text-warn">
      <span>Stress: {active.map(({ key, short }) => `${short} ${pct(stress[key], 1)}`).join(" · ")}</span>
      <button type="button" aria-label="Reset stress test" className="min-h-8 shrink-0 rounded-full px-1" onClick={() => setStress({})}><X size={13} /></button>
    </span>
  );
}

/**
 * Life decisions already in the agreed plan, as compact markers that open
 * their planner. Starting a new decision happens in Goals, not here.
 */
export function InPlanDecisions() {
  const { plan, scopedPerson, scope, ws } = useStore();
  if (!plan || !ws) return null;
  const property = plan.shared.property;
  const household = plan.shared.household;
  const children = [...plan.shared.children].sort((a, b) => a.birth.localeCompare(b.birth));
  const people = scopedPerson ? plan.people.filter((p) => p.id === scopedPerson.id) : plan.people;
  const proposed = new Set(ws.decisions.filter((d) => d.status === "proposed").map((d) => d.id));
  const items: { id: string; href: string; icon: React.ReactNode; title: string; detail: string }[] = [];
  if (!scopedPerson && household.enabled && !property.enabled) items.push({ id: "move-in", href: decisionHref("move-in", scope), icon: <KeyRound size={18} />,
    title: "Living together", detail: `From ${monthLabel(household.move_in)} · rent ${chf(household.rent)}/month` });
  if (!scopedPerson && property.enabled) items.push({ id: "buy-home", href: decisionHref("buy-home", scope), icon: <Home size={18} />,
    title: "Home purchase", detail: `${chf(property.price, { compact: true })} · ${monthLabel(property.purchase)}` });
  if (!scopedPerson && children.length) items.push({ id: "have-child", href: decisionHref("have-child", scope), icon: <Baby size={18} />,
    title: children.length === 1 ? "A child" : `${children.length} children`, detail: `Expected ${monthLabel(children[0].birth)} · ${children[0].childcare_days_per_week} Kita days a week` });
  for (const person of people) {
    const entry = person.career_breaks.find((b) => !b.id.startsWith("cb-child-"));
    if (entry) items.push({ id: `career-break:${person.id}`, href: decisionHref("career-break", scope, { subject: person.id }), icon: <Briefcase size={18} />,
      title: `${person.name}: ${entry.study_program ? entry.label : "career break"}`, detail: `${entry.months} months from ${monthLabel(entry.start)}` });
  }
  return (
    <section aria-labelledby="in-plan" className="rounded-2xl border border-line bg-white shadow-card">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <h2 id="in-plan" className="text-[16px] font-semibold tracking-tight">In your plan</h2>
        <Link href={scopedHref("/goals", scope)} className="min-h-10 content-center text-[14px] font-medium text-accent hover:underline">All goals</Link>
      </div>
      {items.length ? <ul className="mt-1 divide-y divide-line px-2 pb-2 sm:px-3">
        {items.map((item) => (
          <li key={item.id}>
            <Link href={item.href} className="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 hover:bg-page">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sunken text-brand">{item.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-medium text-ink">{item.title}</span>
                <span className="tnum block truncate text-[13px] text-muted">{item.detail}</span>
              </span>
              {proposed.has(item.id.split(":")[0]) && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[12px] font-medium text-warn">Change proposed</span>}
              <ChevronRight size={17} className="shrink-0 text-subtle" />
            </Link>
          </li>
        ))}
      </ul> : <p className="px-4 pt-1 pb-4 text-[14px] leading-6 text-muted sm:px-5">
        No life decisions are agreed yet. You can plan one together in <Link href={scopedHref("/goals", scope)} className="font-medium text-accent hover:underline">Goals</Link>.
      </p>}
    </section>
  );
}
