"use client";

import { Plus } from "lucide-react";

import { chf, monthLabel } from "@/lib/format";
import { useDisplayed, useStore } from "@/lib/store";
import type { Child, ChildCost, Plan } from "@/lib/types";
import { EditRow, PlanSection } from "./EditRow";
import { Button, MonthField, NumberField } from "./ui";

const childPath = "shared.children";

export function useAddChild() {
  const { draftPlan, setChange, ws } = useStore();
  const children = draftPlan?.shared.children ?? [];
  const defaults = ws?.child_defaults.child;
  const canAdd = !!defaults && children.length < 3;
  function addChild() {
    if (!defaults || children.length >= 3) return;
    let number = 1;
    while (children.some((child) => child.id === `child-${number}`)) number++;
    setChange(childPath, [...children, { ...defaults, id: `child-${number}`, label: `Child ${number}` }]);
  }
  return { canAdd, addChild };
}

function ChildEditor({ child, update, remove }: { child: Child; update: (patch: Partial<Child>) => void; remove: () => void }) {
  const { ws } = useStore();
  if (!ws) return null;
  const parents = ws.people;
  const selectClass = "block h-9 max-w-full rounded-lg border border-line-strong bg-white px-2 text-[13px] text-ink";
  return (
    <div className="space-y-3 rounded-xl bg-page p-3 sm:p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-[12px] text-muted">
          <span className="block">Birth month</span>
          <MonthField ariaLabel="Birth month" value={child.birth} onChange={(birth) => update({ birth })} />
        </label>
        <label className="space-y-1 text-[12px] text-muted">
          <span className="block">Childcare days per week</span>
          <NumberField ariaLabel="Childcare days per week" value={child.childcare_days_per_week} min={0} max={5}
            step={0.5} decimals={1} prefix="" width={125} onChange={(childcare_days_per_week) => update({ childcare_days_per_week })} />
        </label>
        <label className="space-y-1 text-[12px] text-muted">
          <span className="block">Birth leave</span>
          <select className={selectClass} value={child.leave.birth_parent} onChange={(event) => {
            const birthParent = event.target.value;
            const otherParent = parents.find((parent) => parent.id !== birthParent);
            if (otherParent) update({ leave: { birth_parent: birthParent, other_parent: otherParent.id } });
          }}>
            {parents.map((parent) => <option key={parent.id} value={parent.id}>{parent.name}</option>)}
          </select>
        </label>
      </div>
      <p className="text-[12px] text-muted">Other-parent leave goes to {parents.find((parent) => parent.id === child.leave.other_parent)?.name}.</p>
      <details>
        <summary className="cursor-pointer py-1.5 text-[13px] font-medium text-accent">Details</summary>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-[12px] text-muted">
            <span className="block">Everyday costs per month</span>
            <NumberField ariaLabel="Everyday child costs per month" value={child.everyday_cost_monthly} step={50}
              width={150} onChange={(everyday_cost_monthly) => update({ everyday_cost_monthly })} />
          </label>
          <label className="space-y-1 text-[12px] text-muted">
            <span className="block">Family allowance recipient</span>
            <select className={selectClass} value={child.allowance_recipient}
              onChange={(event) => update({ allowance_recipient: event.target.value })}>
              {parents.map((parent) => <option key={parent.id} value={parent.id}>{parent.name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-[12px] text-muted">
            <span className="block">Start childcare months after birth</span>
            <NumberField ariaLabel="Start childcare months after birth" value={child.childcare_start_months_after_birth}
              step={1} max={48} prefix="" width={125} onChange={(childcare_start_months_after_birth) => update({ childcare_start_months_after_birth })} />
          </label>
          <label className="space-y-1 text-[12px] text-muted">
            <span className="block">End childcare at age</span>
            <NumberField ariaLabel="End childcare at age" value={child.childcare_until_age}
              step={1} max={4} prefix="" width={125} onChange={(childcare_until_age) => update({ childcare_until_age })} />
          </label>
          <div className="space-y-1 text-[12px] text-muted">
            {child.childcare_day_tariff === null ? (
              <>
                <p>Kita day tariff: Zurich age-based rates</p>
                <button type="button" className="text-[13px] font-medium text-accent hover:underline"
                  onClick={() => update({ childcare_day_tariff: ws.child_defaults.first_day_tariff })}>Set custom tariff</button>
              </>
            ) : (
              <>
                <label className="block space-y-1">
                  <span className="block">Custom Kita day tariff</span>
                  <NumberField ariaLabel="Custom Kita day tariff" value={child.childcare_day_tariff} step={5}
                    width={150} onChange={(childcare_day_tariff) => update({ childcare_day_tariff })} />
                </label>
                <button type="button" className="text-[13px] font-medium text-accent hover:underline"
                  onClick={() => update({ childcare_day_tariff: null })}>Use Zurich rates</button>
              </>
            )}
          </div>
        </div>
      </details>
      <Button variant="ghost" size="sm" onClick={remove}>Remove {child.label.toLowerCase()}</Button>
    </div>
  );
}

export function ChildGoals({ plan }: { plan: Plan }) {
  const { setChange } = useStore();
  const { current } = useDisplayed();
  const { canAdd, addChild } = useAddChild();
  const children = plan.shared.children;
  return (
    <div id="children" className="scroll-mt-44">
      <PlanSection title={children.length > 1 ? "Children" : "Child"} action={canAdd &&
        <button type="button" onClick={addChild} aria-label="Add child" className="flex items-center gap-1 text-[13px] font-medium text-accent">
          <Plus size={14} /> Add
        </button>}>
        {children.length === 0 && <p className="py-3 text-[13px] text-muted">No child planned.</p>}
        {children.map((child) => {
          const result = current?.children.find((entry) => entry.id === child.id && entry.birth === child.birth);
          const firstCare = result?.costs.findIndex((cost) => cost.childcare > 0) ?? -1;
          const firstCost = result?.costs.findIndex((cost) => cost.everyday > 0 || cost.allowance > 0) ?? -1;
          const index = firstCare >= 0 ? firstCare : firstCost;
          return (
            <EditRow key={child.id} label={child.label} sub={`Birth in ${monthLabel(child.birth)}`} defaultOpen={children.length === 1}
              value={result && current && index >= 0 ? <span className="text-right">
                <span className="block">{chf(result.costs[index].net_cost)}</span>
                <span className="block text-[11.5px] font-normal text-muted">Net cost · {monthLabel(current.months[index], true)}</span>
              </span> : null}>
              <ChildEditor child={child}
                update={(patch) => setChange(childPath, children.map((entry) => entry.id === child.id ? { ...entry, ...patch } : entry))}
                remove={() => setChange(childPath, children.filter((entry) => entry.id !== child.id))} />
            </EditRow>
          );
        })}
      </PlanSection>
    </div>
  );
}

export function ChildExpenses({ label, month, cost }: { label: string; month: string; cost: ChildCost }) {
  return (
    <PlanSection title={`${label} costs · ${monthLabel(month)}`}>
      <EditRow label="Everyday costs" value={chf(cost.everyday)} />
      <EditRow label="Childcare" value={chf(cost.childcare)} />
      <EditRow label="Family allowance" value={chf(cost.allowance)} />
      <EditRow label="Net child cost after allowance" value={chf(cost.net_cost)} />
    </PlanSection>
  );
}
