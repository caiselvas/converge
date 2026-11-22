"use client";

import { useStore } from "@/lib/store";
import { LifeDecisions } from "./decisions/LifeDecisions";
import { PersonCareerBreaks, PersonGoalsCard } from "./PersonPlan";

function FinancialGoals() {
  const { plan, draftPlan, scopedPerson, idx } = useStore();
  if (!plan || !draftPlan) return null;
  const people = scopedPerson ? [scopedPerson] : draftPlan.people;
  return (
    <section aria-labelledby="financial-goals">
      <h2 id="financial-goals" className="text-[20px] font-semibold tracking-tight">Financial goals</h2>
      <p className="mt-1 max-w-2xl text-[14px] leading-6 text-muted">
        Everyday savings targets and safety buffers. Each of you owns your own; suggestions for the other need their approval.
      </p>
      <div className={scopedPerson ? "mt-4 max-w-[720px] space-y-4" : "mt-4 grid items-start gap-4 lg:grid-cols-2"}>
        {people.map((p) => <PersonGoalsCard key={p.id} person={p} base={plan.people[idx(p.id)]} title={!scopedPerson} />)}
        {scopedPerson && <PersonCareerBreaks person={scopedPerson} base={plan.people[idx(scopedPerson.id)]} />}
      </div>
    </section>
  );
}

export function GoalsPage() {
  return (
    <div className="mx-auto max-w-[980px] space-y-10 pt-6 sm:pt-9">
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] sm:text-[36px]">Goals</h1>
        <p className="mt-1.5 max-w-2xl text-[15px] leading-6 text-muted">Prepare the big decisions together, and keep your everyday goals on track.</p>
      </div>
      <LifeDecisions />
      <FinancialGoals />
    </div>
  );
}
