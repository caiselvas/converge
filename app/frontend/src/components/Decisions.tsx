"use client";

import * as Popover from "@radix-ui/react-popover";
import { Baby, Briefcase, Gauge, Home, KeyRound, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { chf, monthLabel, pct } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Stress } from "@/lib/types";
import { decisionHref } from "./decisions/registry";
import { Range, clsx } from "./ui";

const chip = "inline-flex min-h-10 items-center gap-2 rounded-full border border-line-strong bg-white px-3.5 text-[13.5px] font-medium text-ink shadow-[0_1px_2px_rgb(15_23_42/0.04)] hover:bg-page focus-visible:ring-2 focus-visible:ring-accent/40";

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

export function Decisions() {
  const { draftPlan, scopedPerson, scope } = useStore();
  if (!draftPlan) return null;
  const property = draftPlan.shared.property;
  const household = draftPlan.shared.household;
  const children = draftPlan.shared.children;
  const firstChild = children.length ? [...children].sort((a, b) => a.birth.localeCompare(b.birth))[0] : null;
  const people = scopedPerson ? [scopedPerson] : draftPlan.people;
  const withoutBreak = people.filter((p) => !p.career_breaks.some((b) => !b.id.startsWith("cb-child-")));
  // Life decisions are planned in Goals. These chips only summarise and navigate; they never change the plan.
  const living = household.enabled && !property.enabled;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!scopedPerson && !property.enabled && <Link href={decisionHref("move-in", scope)} className={chip}>
        <KeyRound size={16} className="text-muted" />
        {living ? `Living together · from ${monthLabel(household.move_in, true)}` : "+ Move in together"}
      </Link>}
      {!scopedPerson && <Link href={decisionHref("buy-home", scope)} className={chip}>
        <Home size={16} className="text-muted" />
        {property.enabled ? `Home · ${chf(property.price, { compact: true })} · ${monthLabel(property.purchase, true)}` : "+ Buy a home"}
      </Link>}
      {!scopedPerson && <Link href={decisionHref("have-child", scope)} className={chip}>
        <Baby size={16} className="text-muted" />
        {firstChild ? `${children.length === 1 ? "Child" : `${children.length} children`} · ${monthLabel(firstChild.birth)}` : "+ Have a child"}
      </Link>}
      {people.flatMap((person) => person.career_breaks.filter((entry) => !entry.id.startsWith("cb-child-")).slice(0, 1).map((entry) => (
        <Link key={person.id} href={decisionHref("career-break", scope, { subject: person.id })} className={chip}>
          <Briefcase size={16} className="text-muted" />{person.name}: {entry.months}-month break from {monthLabel(entry.start, true)}
        </Link>
      )))}
      {withoutBreak.length > 0 && <Link className={chip} href={decisionHref("career-break", scope, { subject: scopedPerson?.id })}>
        <Briefcase size={16} className="text-muted" /> + Career break
      </Link>}
      <StressButton />
    </div>
  );
}
