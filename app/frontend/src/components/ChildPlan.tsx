"use client";

import { chf, monthLabel } from "@/lib/format";
import type { ChildCost } from "@/lib/types";
import { EditRow, PlanSection } from "./EditRow";

// Children are planned in Goals → Have a child. Expenses shows the engine's monthly costs.
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
