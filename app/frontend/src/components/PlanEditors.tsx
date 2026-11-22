"use client";

import { useStore } from "@/lib/store";
import { PersonExpenses, PersonGoals } from "./PersonPlan";
import { SharedExpenses, SharedGoals } from "./SharedPlan";

export function PlanEditors({ page }: { page: "goals" | "expenses" }) {
  const { plan, draftPlan, scopedPerson, idx } = useStore();
  if (!plan || !draftPlan) return null;
  const Personal = page === "goals" ? PersonGoals : PersonExpenses;
  const Shared = page === "goals" ? SharedGoals : SharedExpenses;
  return (
    <div className="mx-auto max-w-[720px] space-y-4 pt-6 sm:pt-9">
      <h1 className="pb-1 text-[28px] font-semibold tracking-[-0.02em] sm:text-[36px]">{page === "goals" ? "Goals" : "Expenses"}</h1>
      {scopedPerson
        ? <Personal key={scopedPerson.id} person={scopedPerson} base={plan.people[idx(scopedPerson.id)]} />
        : <Shared plan={draftPlan} base={plan} />}
    </div>
  );
}
