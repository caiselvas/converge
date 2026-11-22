"use client";

import * as Popover from "@radix-ui/react-popover";
import { Briefcase, Gauge, Home, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { chf, monthLabel, pct } from "@/lib/format";
import { scopedHref, useStore } from "@/lib/store";
import type { Person, Stress } from "@/lib/types";
import { CareerBreakForm } from "./PersonPlan";
import { Range, Segmented, clsx } from "./ui";

const chip = "inline-flex min-h-10 items-center gap-2 rounded-full border border-line-strong bg-white px-3.5 text-[13.5px] font-medium text-ink shadow-[0_1px_2px_rgb(15_23_42/0.04)] hover:bg-page focus-visible:ring-2 focus-visible:ring-accent/40";

const stressFields = [
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

function RemoveDecision({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" aria-label={label} onClick={onClick} className="min-h-10 shrink-0 rounded-full px-2.5 text-muted hover:bg-page hover:text-ink"><X size={14} /></button>;
}

function AddBreak({ people, close }: { people: Person[]; close: () => void }) {
  const { viewer } = useStore();
  const [who, setWho] = useState(viewer);
  const person = people.find((p) => p.id === who) ?? people[0];
  return (
    <div className="space-y-3">
      {people.length > 1 && <Segmented ariaLabel="Who takes the break" value={person.id} onChange={setWho}
        options={people.map((p) => ({ value: p.id, label: p.name }))} />}
      <CareerBreakForm person={person} onClose={close} />
    </div>
  );
}

function StressForm() {
  const { draftPlan, stress, setStress } = useStore();
  if (!draftPlan) return null;
  const property = draftPlan.shared.property;
  const defaults: Required<Stress> = {
    mortgage_rate: property.mortgage_rate,
    expense_inflation: draftPlan.assumptions.expense_inflation,
    investment_return: draftPlan.assumptions.investment_return,
  };
  return (
    <div className="space-y-4">
      <div className="text-[15px] font-semibold">Stress test</div>
      {stressFields.map(({ key, label, min, max, step }) => {
        const value = stress[key] ?? defaults[key];
        const disabled = key === "mortgage_rate" && !property.enabled;
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
      {!property.enabled && <p className="text-[12px] text-muted">Add a home purchase to stress the mortgage rate.</p>}
    </div>
  );
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
  const { draftPlan, scopedPerson, addChanges, setChange } = useStore();
  if (!draftPlan) return null;
  const property = draftPlan.shared.property;
  const people = scopedPerson ? [scopedPerson] : draftPlan.people;
  const withoutBreak = people.filter((p) => !p.career_breaks.length);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!scopedPerson && <span className={clsx("inline-flex items-center rounded-full", property.enabled && "border border-line-strong bg-white")}>
        <Link href={scopedHref("/goals", "together", "#home")} className={clsx(chip, property.enabled && "border-0 shadow-none")}
          onClick={() => {
            if (!property.enabled) addChanges([{ path: "shared.household.enabled", value: true }, { path: "shared.property.enabled", value: true }]);
          }}>
          <Home size={16} className="text-muted" />
          {property.enabled ? `Home · ${chf(property.price, { compact: true })} · ${monthLabel(property.purchase, true)}` : "+ Buy a home"}
        </Link>
        {property.enabled && <RemoveDecision label="Remove home purchase" onClick={() => setChange("shared.property.enabled", false)} />}
      </span>}
      {people.flatMap((person) => person.career_breaks.map((entry) => (
        <span key={`${person.id}:${entry.id}`} className="inline-flex max-w-full items-center rounded-full border border-line-strong bg-white">
          <Pop trigger={<button className={clsx(chip, "min-w-0 border-0 text-left shadow-none")}><Briefcase size={16} className="shrink-0 text-muted" />
            {person.name}: {entry.months}-month break from {monthLabel(entry.start, true)}
          </button>}>
            {(close) => <CareerBreakForm person={person} existing={entry} onClose={close} />}
          </Pop>
          <RemoveDecision label={`Remove ${person.name}’s career break`}
            onClick={() => setChange(`people.${person.id}.career_breaks`, person.career_breaks.filter((b) => b.id !== entry.id))} />
        </span>
      )))}
      {withoutBreak.length > 0 && <Pop trigger={<button className={chip}><Briefcase size={16} className="text-muted" /> + Career break</button>}>
        {(close) => <AddBreak people={withoutBreak} close={close} />}
      </Pop>}
      <Pop trigger={<button className={chip}><Gauge size={16} className="text-muted" /> Stress test</button>}>
        {() => <StressForm />}
      </Pop>
    </div>
  );
}
