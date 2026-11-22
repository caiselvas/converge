export type Owner = "a" | "b" | "shared";
export type EventKind =
  | "move"
  | "study"
  | "break"
  | "home"
  | "parttime"
  | "business"
  | "support"
  | "child";
export interface Person {
  id: "a" | "b";
  name: string;
  birthDate: string;
  canton: string;
  cash: number;
  investments: number;
  income: number;
  personalCosts: number;
  rent: number;
  premiumYoung: number;
  premiumAdult: number;
  reserve: number;
  independentYears: number;
  hasQualification: boolean;
  swissResidenceYears: number;
}
export interface LifeEvent {
  id: string;
  kind: EventKind;
  title: string;
  owner: Owner;
  start: number;
  duration: number;
  amount: number;
  oneOff: number;
  incomePercent: number;
  tuitionTier: "standard" | "increased" | "custom";
  tuitionCustom: number;
  confirmedGrant: number;
  grantConfirmed: boolean;
  approvedBy: ("a" | "b")[];
}
export interface Plan {
  version: 1;
  name: string;
  startDate: string;
  months: number;
  people: [Person, Person];
  events: LifeEvent[];
  assumptions: {
    inflation: number;
    incomeGrowth: number;
    investmentReturn: number;
    mortgageRate: number;
    depositPercent: number;
    purchaseFeesPercent: number;
    maintenancePercent: number;
    amortizationPercent: number;
    split: "income" | "equal" | "custom";
    shareA: number;
    monthlySharedSaving: number;
    seed: number;
  };
}
export interface Month {
  index: number;
  date: string;
  a: number;
  b: number;
  shared: number;
  investments: number;
  property: number;
  debt: number;
  netWorth: number;
  totalCash: number;
  incomeA: number;
  incomeB: number;
  costsA: number;
  costsB: number;
  sharedCosts: number;
  contributionA: number;
  contributionB: number;
  cashFlow: number;
  cumulativeA: number;
  cumulativeB: number;
  tuition: number;
  warnings: string[];
}
export interface Simulation {
  months: Month[];
  minimumA: number;
  minimumB: number;
  minimumShared: number;
  firstBreachA: number | null;
  firstBreachB: number | null;
  firstFundingGap: number | null;
  warnings: string[];
}
export interface Environment {
  expenseFactors: number[];
  incomeFactorsA: number[];
  incomeFactorsB: number[];
  investmentReturns: number[];
}
