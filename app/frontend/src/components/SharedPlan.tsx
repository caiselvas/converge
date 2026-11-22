"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { chf, monthLabel } from "@/lib/format";
import { useDisplayed, useStore } from "@/lib/store";
import type { Plan } from "@/lib/types";
import { ChildExpenses } from "./ChildPlan";
import { decisionHref } from "./decisions/registry";
import { EditRow, PlanSection } from "./EditRow";

const SPLIT_LABEL = { equal: "Equally", income: "In proportion to income", custom: "Custom split" } as const;

function PlanLink({ id, children }: { id: string; children: React.ReactNode }) {
  const { scope } = useStore();
  return (
    <Link href={decisionHref(id, scope)} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
      {children} <ArrowRight size={13} />
    </Link>
  );
}

/**
 * Together view of Expenses: the shared costs that follow from the couple's
 * decisions. Living arrangements, the home and children are edited in their
 * Goals planners, so this view only summarises them.
 */
export function SharedExpenses({ plan }: { plan: Plan }) {
  const { current } = useDisplayed();
  const [month, setMonth] = useState<string>();
  const hh = plan.shared.household;
  const pr = plan.shared.property;
  const sp = plan.shared.split;
  const prop = current?.property;
  const months = current?.months ?? [];
  const firstTransfer = current?.household.joint_transfers.findIndex((total) => total > 0) ?? -1;
  const firstCare = months.findIndex((_, i) => current?.children.some((entry) => entry.costs[i].childcare > 0));
  const index = month && months.includes(month) ? months.indexOf(month) : firstCare >= 0 ? firstCare : Math.max(0, firstTransfer);
  const together = hh.enabled || pr.enabled;
  return (
    <>
      <PlanSection title="Shared household" action={<PlanLink id={pr.enabled ? "buy-home" : "move-in"}>{together ? "Change in Goals" : "Plan it"}</PlanLink>}>
        {!together ? (
          <p className="py-3 text-[13.5px] text-muted">You don&apos;t share a home yet. Each of you pays your own rent and bills.</p>
        ) : (
          <>
            <EditRow label="Living together from" value={monthLabel(hh.enabled ? hh.move_in : pr.purchase)} />
            {hh.enabled && <EditRow label="Shared rent" sub={pr.enabled ? `Until the home purchase in ${monthLabel(pr.purchase)}` : undefined} value={`${chf(hh.rent)}/mo`} />}
            <EditRow label="Utilities" value={`${chf(hh.utilities)}/mo`} />
            <EditRow label="Groceries" sub="Both partners' observed groceries" value={`${chf(hh.groceries)}/mo`} />
            {hh.enabled && <EditRow label="Moving costs" sub="One-off" value={chf(hh.moving_cost)} />}
            <EditRow label="How you share" sub="Paid via a joint account. Home costs follow ownership." value={SPLIT_LABEL[sp.mode]} />
          </>
        )}
      </PlanSection>
      {prop && <PlanSection title="Property running costs" action={<PlanLink id="buy-home">Change in Goals</PlanLink>}>
        <EditRow label="Mortgage interest" value={chf(prop.monthly_interest)} sub="First full month" />
        <EditRow label="Maintenance" value={chf(prop.monthly_maintenance)} />
        <EditRow label="Amortisation" value={chf(prop.monthly_amortization)} />
      </PlanSection>}
      {current?.children.map((child) =>
        <ChildExpenses key={child.id} label={child.label} month={months[index]} cost={child.costs[index]} />)}
      {current && (together || plan.shared.children.length > 0) && <PlanSection title="Who pays what" action={
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
