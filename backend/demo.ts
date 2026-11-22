import type { Plan } from "./types";
import { newEvent } from "./engine";

export function createDemo(): Plan {
  return {
    version: 1,
    name: "Our next chapter",
    startDate: "2027-01-01",
    months: 120,
    people: [
      {
        id: "a",
        name: "Alexia",
        birthDate: "2002-04-18",
        canton: "VD",
        cash: 28000,
        investments: 12000,
        income: 5200,
        personalCosts: 1180,
        rent: 1350,
        premiumYoung: 330,
        premiumAdult: 430,
        reserve: 15000,
        independentYears: 3,
        hasQualification: true,
        swissResidenceYears: 10,
      },
      {
        id: "b",
        name: "Noah",
        birthDate: "1999-09-02",
        canton: "VD",
        cash: 44000,
        investments: 26000,
        income: 6500,
        personalCosts: 1380,
        rent: 1500,
        premiumYoung: 330,
        premiumAdult: 430,
        reserve: 18000,
        independentYears: 5,
        hasQualification: true,
        swissResidenceYears: 10,
      },
    ],
    events: [
      { ...newEvent("move", 8), id: "move-demo" },
      { ...newEvent("study", 20), id: "study-demo" },
    ],
    assumptions: {
      inflation: 0.015,
      incomeGrowth: 0.015,
      investmentReturn: 0.03,
      mortgageRate: 0.025,
      depositPercent: 0.2,
      purchaseFeesPercent: 0.04,
      maintenancePercent: 0.01,
      amortizationPercent: 0.01,
      split: "income",
      shareA: 0.5,
      monthlySharedSaving: 600,
      seed: 2026,
    },
  };
}
export const PRESETS = [
  {
    id: "together",
    title: "A place of our own",
    description: "One home. Two independent futures.",
    kinds: ["move"],
  },
  {
    id: "study",
    title: "Room to start again",
    description: "Move in, then return to university.",
    kinds: ["move", "study"],
  },
  {
    id: "home",
    title: "The keys to our future",
    description: "Share a home, then buy together.",
    kinds: ["move", "home"],
  },
  {
    id: "time",
    title: "More life, less work",
    description: "Two four-day weeks. What gives?",
    kinds: ["move", "parttime", "parttime"],
  },
  {
    id: "breaks",
    title: "Take turns taking time",
    description: "Two sabbaticals, carefully staggered.",
    kinds: ["move", "break", "break"],
  },
  {
    id: "venture",
    title: "One leap, two safety nets",
    description: "A business dream with a protected reserve.",
    kinds: ["move", "business"],
  },
] as const;
export function presetEvents(id: string) {
  const preset = PRESETS.find((p) => p.id === id) ?? PRESETS[1];
  return preset.kinds.map((kind, i) => ({
    ...newEvent(kind, i === 0 ? 8 : kind === "home" ? 60 : i === 1 ? 20 : 32),
    owner: (i === 2
      ? "b"
      : ["move", "home"].includes(kind)
        ? "shared"
        : "a") as "a" | "b" | "shared",
    duration:
      kind === "break"
        ? 9
        : kind === "parttime"
          ? 72
          : kind === "study"
            ? 24
            : 120,
  }));
}
