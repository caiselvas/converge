"use client";

import { useStore } from "@/lib/store";
import { PersonExpenses } from "./PersonPlan";
import { SharedExpenses } from "./SharedPlan";

export function PlanEditors() {
  const { plan, draftPlan, scopedPerson, idx } = useStore();
  if (!plan || !draftPlan) return null;
  return (
    <div className="mx-auto max-w-[720px] space-y-4 pt-6 sm:pt-9">
      <h1 className="pb-1 text-[28px] font-semibold tracking-[-0.02em] sm:text-[36px]">Expenses</h1>
      {scopedPerson
        ? <PersonExpenses key={scopedPerson.id} person={scopedPerson} base={plan.people[idx(scopedPerson.id)]} />
        : <SharedExpenses plan={draftPlan} />}
    </div>
  );
}
