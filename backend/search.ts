import { simulate } from "./engine";
import type { Plan } from "./types";

export interface TimingOption {
  start: number;
  delay: number;
  minimumA: number;
  minimumB: number;
  finalNetWorth: number;
}
/** Searches dates with the exact reference engine; never relaxes personal reserves. */
export function findSaferDates(plan: Plan, eventId: string): TimingOption[] {
  const event = plan.events.find((e) => e.id === eventId);
  if (!event) throw new Error("Select an event first.");
  const options: TimingOption[] = [];
  for (
    let start = event.start;
    start < Math.min(plan.months, event.start + 37);
    start++
  ) {
    if (
      !["move", "home"].includes(event.kind) &&
      start + event.duration > plan.months
    )
      continue;
    const candidate = {
      ...plan,
      events: plan.events.map((e) => (e.id === eventId ? { ...e, start } : e)),
    };
    try {
      const r = simulate(candidate);
      if (
        r.firstBreachA === null &&
        r.firstBreachB === null &&
        r.firstFundingGap === null
      )
        options.push({
          start,
          delay: start - event.start,
          minimumA: r.minimumA,
          minimumB: r.minimumB,
          finalNetWorth: r.months.at(-1)!.netWorth,
        });
    } catch {
      /* Overlap with another work event makes this candidate infeasible. */
    }
  }
  return options
    .filter((o, i) => i === 0 || o.delay >= options[0].delay + 6)
    .slice(0, 3);
}
