import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemo } from "../backend/demo";
import {
  ageAt,
  newEvent,
  premiumFor,
  simulate,
  validatePlan,
} from "../backend/engine";
import { educationChecks, RULES } from "../backend/policy";
import { fitGP, uncertainty } from "../backend/uncertainty";
import { findSaferDates } from "../backend/search";
import type { Plan } from "../backend/types";

function simple(): Plan {
  const p = createDemo();
  p.months = 12;
  p.events = [];
  for (const person of p.people) {
    person.cash = 100000;
    person.investments = 0;
    person.income = 6000;
    person.personalCosts = 1000;
    person.rent = 0;
    person.premiumAdult = 0;
    person.premiumYoung = 0;
    person.reserve = 1000;
  }
  Object.assign(p.assumptions, {
    inflation: 0,
    incomeGrowth: 0,
    investmentReturn: 0,
    monthlySharedSaving: 0,
  });
  return p;
}
test("every month reconciles personal and shared cash and consolidated cash flow", () => {
  const p = createDemo(),
    r = simulate(p);
  let previous = p.people[0].cash + p.people[1].cash;
  for (const m of r.months) {
    assert.ok(Math.abs(previous + m.cashFlow - m.totalCash) < 0.011);
    assert.ok(Math.abs(m.a + m.b + m.shared - m.totalCash) < 0.011);
    assert.ok(
      Math.abs(m.totalCash + m.investments + m.property - m.debt - m.netWorth) <
        0.011,
    );
    previous = m.totalCash;
  }
});
test("moving money into a shared account preserves household wealth", () => {
  const p = simple();
  p.events = [{ ...newEvent("move", 0), id: "move", amount: 0, oneOff: 0 }];
  p.assumptions.monthlySharedSaving = 600;
  const r = simulate(p),
    b = simulate({ ...p, events: [] });
  assert.equal(r.months[0].shared, 600);
  assert.equal(r.months[0].netWorth, b.months[0].netWorth);
  assert.equal(r.months[0].contributionA + r.months[0].contributionB, 600);
});
test("home deposit builds equity; principal repayment reduces debt, not net worth", () => {
  const p = simple();
  p.assumptions.depositPercent = 0.2;
  p.assumptions.purchaseFeesPercent = 0;
  p.assumptions.mortgageRate = 0;
  p.assumptions.maintenancePercent = 0;
  p.assumptions.amortizationPercent = 0.12;
  p.events = [{ ...newEvent("home", 0), id: "home", amount: 200000 }];
  const r = simulate(p),
    b = simulate({ ...p, events: [] });
  assert.equal(r.months[0].property, 200000);
  assert.equal(r.months[0].debt, 158400);
  assert.equal(r.months[0].netWorth, b.months[0].netWorth);
  assert.equal(r.months[11].netWorth, b.months[11].netWorth);
});
test("tuition is charged by semester, grants only after confirmation", () => {
  const p = simple();
  p.events = [
    {
      ...newEvent("study", 0),
      id: "study",
      duration: 12,
      incomePercent: 100,
      confirmedGrant: 1000,
      grantConfirmed: false,
    },
  ];
  const result = simulate(p),
    base = simulate({ ...p, events: [] });
  assert.equal(base.months[11].totalCash - result.months[11].totalCash, 1560);
  assert.equal(result.months[1].tuition, 0);
  p.events[0].grantConfirmed = true;
  assert.equal(
    simulate(p).months[11].totalCash - result.months[11].totalCash,
    12000,
  );
});
test("negative personal cash is not hidden by shared or partner resources", () => {
  const p = simple();
  p.people[0].cash = 100;
  p.people[0].income = 0;
  p.people[0].personalCosts = 1000;
  const r = simulate(p);
  assert.equal(r.firstFundingGap, 0);
  assert.ok(r.months[0].a < 0);
  assert.ok(r.months[0].totalCash > 0);
  assert.equal(r.firstBreachA, -1);
});
test("overlapping work interventions are rejected rather than multiplied silently", () => {
  const p = simple();
  p.events = [
    { ...newEvent("study", 0), duration: 12 },
    { ...newEvent("break", 5), duration: 2 },
  ];
  assert.throws(() => simulate(p), /Overlapping/);
  p.events[1].owner = "b";
  assert.doesNotThrow(() => simulate(p));
});
test("scheduling uses exact attained age while insurance uses tariff calendar year", () => {
  const person = {
    ...simple().people[0],
    birthDate: "2002-12-20",
    premiumYoung: 300,
    premiumAdult: 420,
  };
  assert.equal(ageAt(person.birthDate, "2027-12-19"), 24);
  assert.equal(ageAt(person.birthDate, "2027-12-20"), 25);
  assert.equal(premiumFor(person, "2027-01-01"), 300);
  assert.equal(premiumFor(person, "2028-01-01"), 420);
});
test("scholarship checkpoints do not award support or impose a universal age cutoff", () => {
  const person = {
    birthDate: "1990-01-01",
    canton: "VD",
    independentYears: 8,
    hasQualification: true,
    swissResidenceYears: 12,
  };
  const checks = educationChecks(person, "2027-09-01");
  assert.equal(checks[0].status, "potential");
  assert.ok(checks.every((c) => !("amount" in c)));
  assert.equal(
    educationChecks({ ...person, canton: "GE" }, "2027-09-01")[0].status,
    "not_applicable",
  );
  assert.throws(() => educationChecks(person, "2027-02-30"));
  assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length);
  assert.equal(
    RULES.find((r) => r.id === "vd-education-reform")?.status,
    "proposal",
  );
});
test("GP joint posterior is finite and uncertainty comparisons are reproducible", () => {
  const gp = fitGP([0.01, -0.02, 0.03, 0.01, 0.04, 0], 12);
  assert.ok(gp.mean.every(Number.isFinite));
  assert.ok(gp.L.every((row) => row.every(Number.isFinite)));
  const p = simple();
  const a = uncertainty(p, 20),
    b = uncertainty(p, 20);
  assert.deepEqual(a, b);
  assert.equal(a.differenceMedian, 0);
  assert.deepEqual(a.bands, a.baselineBands);
  assert.ok(a.bands.every((b) => b.low <= b.median && b.median <= b.high));
});
test("invalid financial inputs never create a numerical result", () => {
  const p = simple();
  p.people[0].income = NaN;
  assert.throws(() => validatePlan(p));
  p.people[0].income = 1000;
  p.events = [newEvent("study", 0)];
  p.events[0].oneOff = -1;
  assert.throws(() => validatePlan(p));
  p.events[0].oneOff = 0;
  p.people[0].birthDate = "2002-02-30";
  assert.throws(() => validatePlan(p));
  p.people[0].birthDate = "2002-02-20";
  const incomplete = structuredClone(p);
  delete (incomplete.assumptions as Partial<Plan["assumptions"]>).inflation;
  assert.throws(() => validatePlan(incomplete));
});
test("date search rechecks both personal reserves and rejects impossible plans", () => {
  const p = simple();
  p.months = 48;
  p.people[0].cash = 15000;
  p.people[0].reserve = 10000;
  p.events = [
    {
      ...newEvent("break", 0),
      id: "break-search",
      duration: 9,
      incomePercent: 0,
    },
  ];
  const options = findSaferDates(p, "break-search");
  assert.ok(options.length > 0);
  assert.ok(options[0].delay > 0);
  for (const option of options) {
    const result = simulate({
      ...p,
      events: p.events.map((e) => ({ ...e, start: option.start })),
    });
    assert.equal(result.firstBreachA, null);
    assert.equal(result.firstBreachB, null);
  }
  p.people[0].cash = 100;
  assert.deepEqual(findSaferDates(p, "break-search"), []);
  p.people[0].cash = 100000;
  p.events[0].start = 45;
  assert.deepEqual(findSaferDates(p, "break-search"), []);
});
