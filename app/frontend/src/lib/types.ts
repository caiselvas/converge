// Types mirroring the FastAPI contract (app/backend/converge/models.py, engine/evaluate.py).

export type Month = string; // YYYY-MM

export interface Category {
  key: string;
  label: string;
  group: "housing" | "essential" | "flexible" | "irregular";
  observed_monthly: number;
  budget_monthly: number;
  household: boolean;
  regular: boolean;
}

export interface Goal {
  id: string;
  name: string;
  target_chf: number;
  target_date: Month;
  priority: "high" | "medium" | "low";
  measure: "cash" | "liquid";
  source: string;
}

export interface CareerBreak {
  id: string;
  start: Month;
  months: number;
  income_pct: number;
  one_off_cost_chf: number;
  semester_fee_chf?: number;
  study_program?: ProgramId | null;
  post_study_pay_delta_chf?: number;
  label: string;
}

export type ProgramId = "quant_finance" | "fine_arts";

export interface Program {
  label: string;
  school: string;
  semesters: number;
  semester_fee_chf: number;
  source: string;
  fees_source?: string;
}

export interface WhatIfRequest {
  study?: {
    person: string;
    program: ProgramId;
    start: Month;
    income_pct: number;
    semester_fee_chf: number;
    extra_cost_chf: number;
    monthly_pay_delta: number;
  };
  housing: {
    arrangement: "current" | "separate" | "together";
    move_in?: Month;
    rent?: number;
    split?: "equal" | "income" | "custom";
    first_share?: number;
    adjust_for_breaks?: boolean;
    purchase?: "keep" | "exclude" | "include";
  };
  uncertainty?: { inflation_spread: number; investment_volatility: number };
}

export interface WhatIfLine {
  id: string;
  name: string;
  cash_floor: number | null;
  minimum_cash: number;
  minimum_cash_month: Month;
  end_cash: number;
  end_net_worth: number;
  buffer_gap: number | null;
  change_in_minimum_cash?: number;
  change_in_end_net_worth?: number;
  net_worth_went_below_baseline?: boolean;
  net_worth_break_even_month?: Month | null;
  cash?: number[];
  net_worth?: number[];
}

export interface WhatIfResult {
  assumed_inputs?: string[];
  speakable?: string;
  start: Month;
  end: Month;
  months?: Month[];
  baseline: WhatIfLine[];
  scenario: WhatIfLine[];
  checks_passed: boolean;
  issues: { title: string; person: string | null; severity: "hard" | "soft" }[];
  inputs: {
    study?: Omit<NonNullable<WhatIfRequest["study"]>, "program"> & {
      name: string; program: string; duration_months: number; first_month_after_study: Month;
      published_semester_fee_chf: number; source: string;
      replaced_breaks?: { label: string; start: Month; months: number }[];
    };
    housing: WhatIfRequest["housing"]["arrangement"];
    scenario_housing: Plan["shared"]["household"];
    scenario_split: Plan["shared"]["split"];
    scenario_home_purchase_enabled: boolean;
    scenario_home_purchase?: { price: number; month: Month };
  };
  risk: {
    trials: number;
    seed: number;
    inflation_spread: number;
    investment_volatility: number;
    baseline_breaches: number[];
    scenario_breaches: number[];
    baseline_worth: number[];
    scenario_worth: number[];
    paired_worth_delta: number[];
  } | null;
}

export type WhatIfResponse = WhatIfResult & { draft_changes: Change[] };

export interface Person {
  id: string;
  name: string;
  age: number;
  city: string;
  employment_status: string;
  income_monthly: number;
  income_observed_monthly: number;
  bonus_observed_annual: number;
  include_bonus: boolean;
  opening_cash: number;
  opening_cash_date: Month;
  investments: number;
  investments_as_of: string;
  income_tax_monthly: number;
  pension_opening_chf: number;
  pension_credit_monthly: number;
  liabilities: { id: string; kind: string; principal_chf: number }[];
  categories: Category[];
  emergency_floor: number;
  goals: Goal[];
  career_breaks: CareerBreak[];
}

export interface Stress {
  mortgage_rate?: number;
  expense_inflation?: number;
  investment_return?: number;
}

export interface Child {
  id: string;
  label: string;
  birth: Month;
  everyday_cost_monthly: number;
  childcare_days_per_week: number;
  childcare_day_tariff: number | null;
  childcare_start_months_after_birth: number;
  childcare_until_age: number;
  allowance_recipient: string;
  leave: { birth_parent: string; other_parent: string };
}

export interface ChildCost {
  everyday: number;
  childcare: number;
  allowance: number;
  net_cost: number;
}

export interface Plan {
  people: [Person, Person];
  shared: {
    children: Child[];
    household: { enabled: boolean; move_in: Month; rent: number; utilities: number; groceries: number; moving_cost: number };
    split: { mode: "equal" | "income" | "custom"; custom_share_first: number; adjust_for_breaks: boolean };
    property: {
      enabled: boolean;
      purchase: Month;
      price: number;
      deposit_pct: number;
      fees_pct: number;
      ownership_share_first: number;
      mortgage_rate: number;
      maintenance_pct: number;
      amortize: boolean;
      target_date: Month;
    };
  };
  assumptions: {
    start: Month;
    horizon_months: number;
    tax_rate: number;
    expense_inflation: number;
    income_growth: number;
    investment_return: number;
    cash_interest: number;
    property_appreciation: number;
    imputed_rate: number;
    affordability_max_ratio: number;
    second_mortgage_ltv: number;
    amortization_years: number;
  };
}

export interface Change {
  path: string;
  value: unknown;
  note?: string | null;
}

export interface DescribedChange extends Change {
  previous: unknown;
  label: string;
  unit: string;
  scope: string;
  owner_name: string | null;
  delta_monthly_chf: number | null;
  previous_text: string;
  value_text: string;
}

export interface Driver {
  label: string;
  amount_chf: number;
}

export interface Issue {
  id: string;
  severity: "hard" | "soft";
  kind: "liquidity_floor" | "goal" | "affordability" | "home_goal";
  person: string | null;
  month: Month;
  worst_month?: Month;
  amount_chf: number;
  months_below?: number;
  months_late?: number;
  title: string;
  detail: string;
  drivers: Driver[];
  needs_financing?: boolean;
  priority?: string;
}

export interface GoalStatus {
  id: string;
  name: string;
  priority: string;
  measure: "cash" | "liquid";
  source: string;
  target_chf: number;
  target_date: Month;
  reserved_before_chf: number;
  projected_chf: number;
  shortfall_chf: number;
  progress: number;
  met: boolean;
  in_horizon: boolean;
  reached_month: Month | null;
}

export interface PersonResult {
  id: string;
  name: string;
  floor: number;
  start_cash: number;
  end_cash: number;
  end_net_worth: number;
  start_net_worth: number;
  min_cash: number;
  min_cash_month: Month;
  headroom: number;
  lowest_runway_months: number | null;
  lowest_runway_month: Month;
  avg_monthly_saving: number;
  breach: boolean;
  goals: GoalStatus[];
}

export interface Affordability {
  month: Month;
  annual_net_income: number;
  imputed_interest: number;
  maintenance: number;
  amortization: number;
  annual_cost: number;
  ratio: number | null;
  max_ratio: number;
  max_price: number | null;
  passes: boolean;
}

export interface PropertyResult {
  purchase: Month;
  in_horizon: boolean;
  price: number;
  deposit: number;
  fees: number;
  mortgage: number;
  monthly_interest: number;
  monthly_maintenance: number;
  monthly_amortization: number;
  ownership: [number, number];
  contributions: [number, number];
  affordability: Affordability | null;
  end_mortgage: number;
  target_date: Month;
}

export interface PlanEvent {
  month: Month;
  kind: "move_in" | "purchase" | "career_break" | "child_birth";
  label: string;
  person: string | null;
  end?: Month;
}

export type SeriesKey =
  | "cash" | "investments" | "pension" | "net_worth" | "income" | "family_allowance" | "tax" | "spending" | "household"
  | "housing" | "amortization" | "one_off" | "deposit" | "net_flow" | "property_value" | "mortgage";

export interface Evaluation {
  status: "on_track" | "attention" | "conflict";
  months: Month[];
  people: [PersonResult, PersonResult];
  issues: Issue[];
  property: PropertyResult | null;
  children: { id: string; label: string; birth: Month; costs: ChildCost[] }[];
  events: PlanEvent[];
  household: { cash: number[]; net_worth: number[]; property_value: number[]; mortgage: number[]; joint_transfers: number[]; share_first: number[] };
  series: Record<string, Record<SeriesKey, number[]>>;
  checks: Record<string, number | boolean>;
}

export interface SimResponse {
  evaluation: Evaluation;
  base?: Evaluation;
  plan: Plan;
  changes: DescribedChange[];
  approvers: string[];
}

export interface RecPersonImpact {
  id: string;
  name: string;
  floor: number;
  min_cash: [number, number];
  min_cash_month: [Month, Month];
  headroom: [number, number];
  runway: [number | null, number | null];
  end_cash: [number, number];
  end_net_worth: [number, number];
  goals: {
    name: string;
    met: [boolean, boolean];
    projected: [number, number];
    target: number;
    target_date: [Month, Month];
    reached_month: [Month | null, Month | null];
    shortfall: [number, number];
    in_horizon: boolean;
  }[];
}

export interface Recommendation {
  id: string;
  strategy: "lifestyle" | "speed" | "resilience";
  strategy_title: string;
  strategy_blurb: string;
  concession: boolean;
  title: string;
  changes: DescribedChange[];
  raw_changes: Change[];
  approvers: string[];
  disruption: number;
  resolves: string[];
  remaining: string[];
  introduces: string[];
  tradeoffs: string[];
  why: string;
  optionality: { lowest_runway_months: [number, number]; min_headroom: number | null };
  people: [RecPersonImpact, RecPersonImpact];
  shared: {
    purchase: [Month, Month];
    price: [number, number];
    contributions: [[number, number], [number, number]];
    target_date: Month;
    on_time: [boolean, boolean];
    affordability_ratio: [number | null, number | null];
  } | null;
  status: Evaluation["status"];
  verified: boolean;
  assumptions: string[];
}

export interface RecResponse {
  status: Evaluation["status"];
  evaluated: number;
  recommendations: Recommendation[];
  message: string | null;
  closest?: Recommendation | null;
}

export interface Proposal {
  id: string;
  author: string;
  title: string;
  note: string;
  kind: "manual" | "recommendation" | "assistant" | "restore";
  changes: Change[];
  described: DescribedChange[];
  approvals: Record<string, "pending" | "approved" | "rejected">;
  status: "pending" | "applied" | "rejected" | "superseded";
  created_at: string;
  decided_at: string | null;
  error: string | null;
  version_id: number | null;
}

export interface VersionInfo {
  id: number;
  title: string;
  author: string | null;
  created_at: string;
  proposal_id: string | null;
}

export interface Workspace {
  plan: Plan;
  people: { id: string; name: string }[];
  versions: VersionInfo[];
  proposals: Proposal[];
  llm_available: boolean;
  child_defaults: { child: Child; first_day_tariff: number };
}

export interface AssumptionRow {
  id: string;
  name: string;
  value: number | null;
  unit: string | null;
  kind: "official" | "dataset" | "illustrative" | "user" | "derived";
  source: string | null;
  note: string;
  source_detail: { name: string; url: string | null; date: string } | null;
}

export type LlmProvider = "anthropic" | "openai";

export interface InterpretResponse {
  mode: "llm" | "offline";
  provider?: LlmProvider;
  model: string | null;
  summary: string;
  clarification: string | null;
  changes: Change[];
  described: DescribedChange[];
  rejected: string[];
  notice?: string;
}

export interface ExplainResponse {
  mode: "llm" | "deterministic";
  provider?: LlmProvider;
  model?: string;
  text: string;
  grounded: boolean;
  notice?: string;
}
