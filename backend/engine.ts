import type {
  Environment,
  LifeEvent,
  Month,
  Person,
  Plan,
  Simulation,
} from "./types";

// All ledger entries are integer centimes. Rates are applied before rounding each entry.
export const cents = (chf: number) => Math.round(chf * 100);
const chf = (value: number) => value / 100;
export function monthDate(start: string, month: number): string {
  const date = new Date(`${start.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + month);
  return date.toISOString().slice(0, 10);
}
export function ageAt(birthDate: string, onDate: string): number {
  const b = new Date(`${birthDate}T12:00:00Z`),
    d = new Date(`${onDate}T12:00:00Z`);
  return (
    d.getUTCFullYear() -
    b.getUTCFullYear() -
    (d.getUTCMonth() < b.getUTCMonth() ||
    (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate())
      ? 1
      : 0)
  );
}
export function premiumFor(person: Person, date: string): number {
  // KVG tariff age group follows calendar year, rather than the birthday itself.
  const calendarAge =
    Number(date.slice(0, 4)) - Number(person.birthDate.slice(0, 4));
  return calendarAge <= 25 ? person.premiumYoung : person.premiumAdult;
}
const active = (event: LifeEvent, m: number) =>
  m >= event.start && m < event.start + event.duration;
export function validatePlan(plan: Plan): void {
  const finite = (x: number) => typeof x === "number" && Number.isFinite(x);
  const validDate = (d: string) =>
    typeof d === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    Number.isFinite(Date.parse(d)) &&
    new Date(d).toISOString().slice(0, 10) === d;
  if (
    plan.version !== 1 ||
    !Number.isInteger(plan.months) ||
    plan.months < 1 ||
    plan.months > 360
  )
    throw new Error("Planning horizon must be between 1 and 360 months.");
  if (!validDate(plan.startDate) || !plan.startDate.endsWith("-01"))
    throw new Error("Choose a valid first day of a month.");
  if (
    plan.people.length !== 2 ||
    plan.people[0].id !== "a" ||
    plan.people[1].id !== "b"
  )
    throw new Error("Two distinct personal profiles are required.");
  for (const p of plan.people) {
    if (!validDate(p.birthDate) || ageAt(p.birthDate, plan.startDate) < 18)
      throw new Error(
        "This prototype supports adult profiles with valid birth dates only.",
      );
    for (const k of [
      "cash",
      "investments",
      "income",
      "personalCosts",
      "rent",
      "premiumYoung",
      "premiumAdult",
      "reserve",
      "independentYears",
      "swissResidenceYears",
    ] as const)
      if (!finite(p[k]) || p[k] < 0 || p[k] > 10000000)
        throw new Error(`Invalid ${p.name} ${k}.`);
    if (
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name.length > 60 ||
      typeof p.canton !== "string" ||
      typeof p.hasQualification !== "boolean"
    )
      throw new Error("Complete the personal profile fields.");
  }
  const a = plan.assumptions;
  for (const key of [
    "inflation",
    "incomeGrowth",
    "investmentReturn",
    "mortgageRate",
    "depositPercent",
    "purchaseFeesPercent",
    "maintenancePercent",
    "amortizationPercent",
    "shareA",
    "monthlySharedSaving",
    "seed",
  ] as const)
    if (!finite(a[key])) throw new Error("Assumptions must be finite.");
  if (
    !["equal", "income", "custom"].includes(a.split) ||
    !Number.isInteger(a.seed) ||
    a.seed < 0 ||
    a.seed > 4294967295
  )
    throw new Error("Invalid contribution rule or random seed.");
  if (
    a.inflation < -0.1 ||
    a.inflation > 0.3 ||
    a.incomeGrowth < -0.2 ||
    a.incomeGrowth > 0.3 ||
    a.investmentReturn <= -1 ||
    a.investmentReturn > 1
  )
    throw new Error("Growth assumptions are outside supported bounds.");
  if (
    a.shareA < 0 ||
    a.shareA > 1 ||
    a.depositPercent < 0.1 ||
    a.depositPercent > 1 ||
    a.mortgageRate < 0 ||
    a.mortgageRate > 0.2 ||
    a.monthlySharedSaving < 0 ||
    a.monthlySharedSaving > 10000000 ||
    a.purchaseFeesPercent < 0 ||
    a.purchaseFeesPercent > 1 ||
    a.maintenancePercent < 0 ||
    a.maintenancePercent > 1 ||
    a.amortizationPercent < 0 ||
    a.amortizationPercent > 1
  )
    throw new Error("Invalid shared-finance assumptions.");
  const ids = new Set<string>();
  for (const e of plan.events) {
    if (ids.has(e.id)) throw new Error("Event IDs must be unique.");
    ids.add(e.id);
    if (
      ![
        "move",
        "study",
        "break",
        "home",
        "parttime",
        "business",
        "support",
        "child",
      ].includes(e.kind) ||
      !["a", "b", "shared"].includes(e.owner)
    )
      throw new Error("Invalid event type or owner.");
    if (
      ["study", "break", "parttime", "business"].includes(e.kind) &&
      e.owner === "shared"
    )
      throw new Error("Career and education events must belong to one person.");
    if (
      !Number.isInteger(e.start) ||
      e.start < 0 ||
      e.start >= plan.months ||
      !Number.isInteger(e.duration) ||
      e.duration < 1 ||
      e.duration > 360
    )
      throw new Error("Event dates must lie inside the plan.");
    if (
      [
        e.amount,
        e.oneOff,
        e.incomePercent,
        e.tuitionCustom,
        e.confirmedGrant,
      ].some((x) => !finite(x) || x < 0 || x > 10000000) ||
      e.incomePercent > 100
    )
      throw new Error("Invalid event amount or working percentage.");
    if (
      !["standard", "increased", "custom"].includes(e.tuitionTier) ||
      typeof e.grantConfirmed !== "boolean" ||
      !Array.isArray(e.approvedBy) ||
      e.approvedBy.some((id) => !["a", "b"].includes(id)) ||
      new Set(e.approvedBy).size !== e.approvedBy.length ||
      typeof e.title !== "string"
    )
      throw new Error("Invalid event details or review markers.");
  }
  if (
    plan.events.filter((e) => e.kind === "home").length > 1 ||
    plan.events.filter((e) => e.kind === "move").length > 1
  )
    throw new Error("Model one shared home purchase and one move per plan.");
  for (const owner of ["a", "b"]) {
    const work = plan.events.filter(
      (e) =>
        e.owner === owner &&
        ["study", "break", "parttime", "business"].includes(e.kind),
    );
    for (let i = 0; i < work.length; i++)
      for (let j = i + 1; j < work.length; j++)
        if (
          work[i].start < work[j].start + work[j].duration &&
          work[j].start < work[i].start + work[i].duration
        )
          throw new Error(
            `Overlapping work or study changes for partner ${owner.toUpperCase()}. Adjust their dates.`,
          );
  }
}

export function simulate(plan: Plan, environment?: Environment): Simulation {
  validatePlan(plan);
  const a = plan.assumptions,
    [pa, pb] = plan.people;
  let cashA = cents(pa.cash),
    cashB = cents(pb.cash),
    shared = 0;
  let inv = cents(pa.investments + pb.investments),
    property = 0,
    debt = 0,
    originalDebt = 0;
  let cumulativeA = 0,
    cumulativeB = 0;
  const months: Month[] = [],
    warnings = new Set<string>();
  if (
    plan.events.some(
      (e) =>
        !["move", "home"].includes(e.kind) &&
        e.start + e.duration > plan.months,
    )
  )
    warnings.add(
      "An event continues beyond the planning horizon. Costs and income changes after the horizon are not included.",
    );
  const move = plan.events.find((e) => e.kind === "move"),
    home = plan.events.find((e) => e.kind === "home");
  if (plan.events.some((e) => e.grantConfirmed && e.confirmedGrant > 0))
    warnings.add(
      "Grant cash flows use your confirmed award input; eligibility is not an award decision.",
    );
  if (home)
    warnings.add(
      "Home model excludes property appreciation, pension withdrawals, imputed-rent taxation and tax deductions. Mortgage approval is not assessed.",
    );
  const monthlyReturn = (1 + a.investmentReturn) ** (1 / 12) - 1;
  for (let m = 0; m < plan.months; m++) {
    const date = monthDate(plan.startDate, m),
      escalation = (1 + a.inflation) ** (m / 12);
    const costFactor = environment?.expenseFactors[m] ?? 1;
    const combined = !!(move && m >= move.start) || !!(home && m >= home.start);
    let incomeA = pa.income * (1 + a.incomeGrowth) ** (m / 12),
      incomeB = pb.income * (1 + a.incomeGrowth) ** (m / 12);
    let personalA = cents(
      (pa.personalCosts * costFactor +
        premiumFor(pa, date) +
        (combined ? 0 : pa.rent)) *
        escalation,
    );
    let personalB = cents(
      (pb.personalCosts * costFactor +
        premiumFor(pb, date) +
        (combined ? 0 : pb.rent)) *
        escalation,
    );
    let sharedCost =
      combined && !(home && m >= home.start)
        ? cents((move?.amount ?? pa.rent + pb.rent) * escalation)
        : 0;
    let tuition = 0;
    for (const e of plan.events) {
      if (!active(e, m)) continue;
      let charge = 0;
      if (["study", "break", "parttime", "business"].includes(e.kind)) {
        if (e.owner === "a") incomeA *= e.incomePercent / 100;
        else incomeB *= e.incomePercent / 100;
      }
      if (e.kind === "study") {
        const semester =
          e.tuitionTier === "standard"
            ? 780
            : e.tuitionTier === "increased"
              ? 2240
              : e.tuitionCustom;
        if ((m - e.start) % 6 === 0) {
          charge += cents(semester);
          tuition += cents(semester);
        }
        if (e.grantConfirmed) charge -= cents(e.confirmedGrant);
      }
      if (["support", "child", "business"].includes(e.kind))
        charge += cents(e.amount * escalation);
      if (m === e.start && e.kind !== "home") charge += cents(e.oneOff);
      if (e.owner === "a") personalA += charge;
      else if (e.owner === "b") personalB += charge;
      else sharedCost += charge;
    }
    incomeA = cents(incomeA * (environment?.incomeFactorsA[m] ?? 1));
    incomeB = cents(incomeB * (environment?.incomeFactorsB[m] ?? 1));
    const share =
      a.split === "equal"
        ? 0.5
        : a.split === "custom"
          ? a.shareA
          : incomeA + incomeB > 0
            ? incomeA / (incomeA + incomeB)
            : 0.5;
    if (home && m === home.start) {
      property = cents(home.amount);
      originalDebt = Math.round(property * (1 - a.depositPercent));
      debt = originalDebt;
      // The down payment moves cash into home equity; only fees destroy net worth.
      sharedCost +=
        property - debt + cents(home.amount * a.purchaseFeesPercent);
    }
    if (property > 0) {
      const interest = Math.round((debt * a.mortgageRate) / 12);
      const principal = Math.min(
        debt,
        Math.round((originalDebt * a.amortizationPercent) / 12),
      );
      debt -= principal;
      sharedCost +=
        interest +
        principal +
        Math.round((property * a.maintenancePercent) / 12);
    }
    const savings = combined ? cents(a.monthlySharedSaving) : 0;
    const contributionA = Math.round((sharedCost + savings) * share),
      contributionB = sharedCost + savings - contributionA;
    cashA += incomeA - personalA - contributionA;
    cashB += incomeB - personalB - contributionB;
    shared += contributionA + contributionB - sharedCost;
    cumulativeA += contributionA;
    cumulativeB += contributionB;
    const ret = environment?.investmentReturns[m] ?? monthlyReturn;
    inv = Math.max(0, inv + Math.round(inv * ret));
    const mw: string[] = [];
    if (cashA < cents(pa.reserve)) mw.push(`${pa.name}'s personal reserve`);
    if (cashB < cents(pb.reserve)) mw.push(`${pb.name}'s personal reserve`);
    if (cashA < 0 || cashB < 0 || shared < 0)
      mw.push("Unfunded cash shortfall");
    const totalCash = cashA + cashB + shared;
    months.push({
      index: m,
      date,
      a: chf(cashA),
      b: chf(cashB),
      shared: chf(shared),
      investments: chf(inv),
      property: chf(property),
      debt: chf(debt),
      netWorth: chf(totalCash + inv + property - debt),
      totalCash: chf(totalCash),
      incomeA: chf(incomeA),
      incomeB: chf(incomeB),
      costsA: chf(personalA),
      costsB: chf(personalB),
      sharedCosts: chf(sharedCost),
      contributionA: chf(contributionA),
      contributionB: chf(contributionB),
      cashFlow: chf(incomeA + incomeB - personalA - personalB - sharedCost),
      cumulativeA: chf(cumulativeA),
      cumulativeB: chf(cumulativeB),
      tuition: chf(tuition),
      warnings: mw,
    });
  }
  const first = (fn: (m: Month) => boolean) => months.find(fn)?.index ?? null;
  return {
    months,
    minimumA: Math.min(pa.cash, ...months.map((m) => m.a)),
    minimumB: Math.min(pb.cash, ...months.map((m) => m.b)),
    minimumShared: Math.min(0, ...months.map((m) => m.shared)),
    firstBreachA: pa.cash < pa.reserve ? -1 : first((m) => m.a < pa.reserve),
    firstBreachB: pb.cash < pb.reserve ? -1 : first((m) => m.b < pb.reserve),
    firstFundingGap: first((m) => m.a < 0 || m.b < 0 || m.shared < 0),
    warnings: [...warnings],
  };
}

export const EVENT_LABELS: Record<LifeEvent["kind"], string> = {
  move: "Move in together",
  study: "Return to university",
  break: "Take a sabbatical",
  home: "Buy a home",
  parttime: "A four-day week",
  business: "Build a business",
  support: "Support family",
  child: "Welcome a child",
};
export function newEvent(kind: LifeEvent["kind"], start = 12): LifeEvent {
  return {
    id: crypto.randomUUID(),
    kind,
    title: EVENT_LABELS[kind],
    owner: ["move", "home", "child"].includes(kind) ? "shared" : "a",
    start,
    duration: kind === "study" ? 24 : kind === "break" ? 6 : 120,
    amount:
      kind === "move"
        ? 2300
        : kind === "home"
          ? 720000
          : kind === "child"
            ? 1400
            : kind === "business"
              ? 500
              : kind === "support"
                ? 400
                : 0,
    oneOff:
      kind === "move"
        ? 3500
        : kind === "business"
          ? 12000
          : kind === "child"
            ? 3000
            : 0,
    incomePercent:
      kind === "study"
        ? 25
        : kind === "parttime"
          ? 80
          : kind === "break" || kind === "business"
            ? 0
            : 100,
    tuitionTier: "standard",
    tuitionCustom: 780,
    confirmedGrant: 0,
    grantConfirmed: false,
    approvedBy: [],
  };
}
