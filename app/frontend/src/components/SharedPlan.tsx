"use client";

import { useState } from "react";

import { chf, monthLabel, pct } from "@/lib/format";
import { getPath } from "@/lib/plan";
import { useDisplayed, useStore } from "@/lib/store";
import type { Plan } from "@/lib/types";
import { EditRow, PlanSection } from "./EditRow";
import { InfoTip, MonthField, NumberField, Range, Segmented, Toggle, clsx } from "./ui";

function ToggleRow({ label, sub, checked, onChange }: { label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-[14px] font-medium text-ink">{label}</div>
        {sub && <div className="text-[12px] text-muted">{sub}</div>}
      </div>
      <Toggle label={label} checked={checked} onChange={onChange} />
    </div>
  );
}

export function SharedGoals({ plan, base }: { plan: Plan; base: Plan }) {
  const { setChange: set } = useStore();
  const { current } = useDisplayed();
  const ch = (path: string) => JSON.stringify(getPath(plan, path)) !== JSON.stringify(getPath(base, path));
  const pr = plan.shared.property;
  const sp = plan.shared.split;
  const [a, b] = plan.people;
  const aff = current?.property?.affordability;
  const prop = current?.property;
  const hasBreak = plan.people.some((p) => p.career_breaks.length > 0);

  return (
    <>
      <div id="home" className="scroll-mt-44">
      <PlanSection title="Home">
        <ToggleRow label="Buy a home together" sub="Ownership follows each partner's share of the deposit" checked={pr.enabled}
          onChange={(v) => set("shared.property.enabled", v)} />
        {pr.enabled && (
          <div className="fade-up">
            <EditRow label="Price" value={chf(pr.price)} changed={ch("shared.property.price")}>
              <NumberField ariaLabel="Price" value={pr.price} step={50_000} width={190} onChange={(v) => set("shared.property.price", v)} />
            </EditRow>
            <EditRow label="Buy in" value={monthLabel(pr.purchase)} changed={ch("shared.property.purchase")}>
              <MonthField ariaLabel="Purchase month" value={pr.purchase} min={plan.assumptions.start} onChange={(v) => set("shared.property.purchase", v)} />
            </EditRow>
            <div className="border-b border-line/80 py-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[14px]">Deposit</span>
                <span className="tnum text-[14px] font-medium">{pct(pr.deposit_pct)} <span className="font-normal text-muted">· {chf(prop?.deposit, { compact: true })}</span></span>
              </div>
              <div className="mt-3"><Range ariaLabel="Deposit percentage" value={Math.round(pr.deposit_pct * 100)} min={20} max={50} step={1} onChange={(v) => set("shared.property.deposit_pct", v / 100)} /></div>
            </div>
            <div className="border-b border-line/80 py-3">
              <div className="text-[14px]">Who pays the deposit</div>
              <div className="mt-3"><Range ariaLabel={`${a.name}'s share of the deposit`} value={Math.round(pr.ownership_share_first * 100)} min={0} max={100} step={5} color="var(--color-p0)" onChange={(v) => set("shared.property.ownership_share_first", v / 100)} /></div>
              <div className="tnum mt-2 flex justify-between text-[12.5px]">
                <span><b className="text-p0">{a.name} {pct(pr.ownership_share_first)}</b> <span className="text-muted">{chf(prop?.contributions[0], { compact: true })}</span></span>
                <span><span className="text-muted">{chf(prop?.contributions[1], { compact: true })}</span> <b className="text-p1">{b.name} {pct(prop?.ownership[1])}</b></span>
              </div>
            </div>
            {aff && (
              <div className="flex items-baseline justify-between py-3 text-[14px]">
                <span className="flex items-center gap-1">Affordability <InfoTip content="Converge compares imputed interest, maintenance and required amortisation with combined usual net pay before career breaks and any optional extra deduction. Lenders use gross income for their assessment." /></span>
                <span className={clsx("tnum font-medium", aff.passes ? "text-good" : "text-bad-strong")}>
                  {pct(aff.ratio, 1)} <span className="font-normal text-muted">of max {pct(aff.max_ratio)}</span>
                </span>
              </div>
            )}
            {aff && !aff.passes && <p className="pb-2 text-[12.5px] text-bad-strong">Highest price that passes with this deposit: {chf(aff.max_price)}.</p>}
            <details className="mt-1">
              <summary className="cursor-pointer py-2 text-[13px] font-medium text-accent">Mortgage details</summary>
              <EditRow label="Mortgage rate" value={pct(pr.mortgage_rate, 2)} changed={ch("shared.property.mortgage_rate")}>
                <NumberField ariaLabel="Mortgage rate percent" value={Number((pr.mortgage_rate * 100).toFixed(2))} step={0.1} decimals={2} prefix="" suffix="%" width={150}
                  onChange={(v) => set("shared.property.mortgage_rate", Number((v / 100).toFixed(4)))} />
              </EditRow>
              <EditRow label="We hope to own by" value={monthLabel(pr.target_date)} changed={ch("shared.property.target_date")}>
                <MonthField ariaLabel="Target date" value={pr.target_date} onChange={(v) => set("shared.property.target_date", v)} />
              </EditRow>
              {prop && <EditRow label="Mortgage" value={chf(prop.mortgage, { compact: true })} />}
              <ToggleRow label="Amortise directly" sub="Second mortgage repaid within 15 years" checked={pr.amortize} onChange={(v) => set("shared.property.amortize", v)} />
            </details>
          </div>
        )}
      </PlanSection>
      </div>

      <PlanSection title="Contribution split">
          <div className="py-3">
            <Segmented ariaLabel="Cost-sharing rule" value={sp.mode} onChange={(v) => set("shared.split.mode", v)}
              options={[{ value: "equal", label: "Equal" }, { value: "income", label: "By income" }, { value: "custom", label: "Custom" }]} />
            {sp.mode === "custom" && (
              <div className="mt-4"><Range ariaLabel={`${a.name}'s share of household costs`} value={Math.round(sp.custom_share_first * 100)} min={0} max={100} step={5} color="var(--color-p0)" onChange={(v) => set("shared.split.custom_share_first", v / 100)} /></div>
            )}
            <p className="mt-1 text-[12px] text-muted">Household costs, paid via a joint account. Home costs follow ownership.</p>
          </div>
          {hasBreak && (
            <ToggleRow label="Cover each other during a career break" sub="Contributions follow actual income while one partner earns less"
              checked={sp.adjust_for_breaks} onChange={(v) => set("shared.split.adjust_for_breaks", v)} />
          )}
      </PlanSection>
    </>
  );
}

export function SharedExpenses({ plan, base }: { plan: Plan; base: Plan }) {
  const { setChange: set } = useStore();
  const { current } = useDisplayed();
  const [month, setMonth] = useState<string>();
  const hh = plan.shared.household;
  const pr = plan.shared.property;
  const prop = current?.property;
  const ch = (path: string) => getPath(plan, path) !== getPath(base, path);
  const months = current?.months ?? [];
  const firstTransfer = current?.household.joint_transfers.findIndex((total) => total > 0) ?? -1;
  const index = month && months.includes(month) ? months.indexOf(month) : Math.max(0, firstTransfer);
  return (
    <>
      <PlanSection title="Shared household costs">
        <ToggleRow label="Move in together" sub="One shared home replaces both current rents" checked={hh.enabled} onChange={(v) => set("shared.household.enabled", v)} />
        <div>
            <EditRow label="From" value={monthLabel(hh.move_in)} changed={ch("shared.household.move_in")}>
              <MonthField ariaLabel="Move-in month" value={hh.move_in} min={plan.assumptions.start} onChange={(v) => set("shared.household.move_in", v)} />
            </EditRow>
            <EditRow label="Shared rent" sub={pr.enabled ? `Until the home purchase in ${monthLabel(pr.purchase)}` : undefined} value={chf(hh.rent)} changed={ch("shared.household.rent")}>
              <NumberField ariaLabel="Shared rent" value={hh.rent} step={50} width={170} onChange={(v) => set("shared.household.rent", v)} />
            </EditRow>
            <details>
              <summary className="cursor-pointer py-2 text-[13px] font-medium text-accent">Other shared costs</summary>
              <EditRow label="Utilities" value={chf(hh.utilities)} changed={ch("shared.household.utilities")}>
                <NumberField ariaLabel="Utilities" value={hh.utilities} step={10} width={170} onChange={(v) => set("shared.household.utilities", v)} />
              </EditRow>
              <EditRow label="Groceries" sub="Both partners' observed groceries" value={chf(hh.groceries)} changed={ch("shared.household.groceries")}>
                <NumberField ariaLabel="Groceries" value={hh.groceries} step={20} width={170} onChange={(v) => set("shared.household.groceries", v)} />
              </EditRow>
              <EditRow label="Moving costs" sub="One-off" value={chf(hh.moving_cost)} changed={ch("shared.household.moving_cost")}>
                <NumberField ariaLabel="Moving costs" value={hh.moving_cost} step={250} width={170} onChange={(v) => set("shared.household.moving_cost", v)} />
              </EditRow>
            </details>
        </div>
      </PlanSection>
      {prop && <PlanSection title="Property running costs">
        <EditRow label="Mortgage interest" value={chf(prop.monthly_interest)} sub="First full month" />
        <EditRow label="Maintenance" value={chf(prop.monthly_maintenance)} />
        <EditRow label="Amortisation" value={chf(prop.monthly_amortization)} />
      </PlanSection>}
      {current && <PlanSection title="Who pays what" action={
        <select aria-label="Contribution month" value={months[index]} onChange={(e) => setMonth(e.target.value)} className="max-w-full rounded-lg border border-line bg-white py-1.5 text-[12px] text-ink">
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      }>
        {current.people.map((person) => <EditRow key={person.id} label={person.name} sub="Joint account contribution"
          value={chf(current.series[person.id].household[index])} />)}
      </PlanSection>}
    </>
  );
}
