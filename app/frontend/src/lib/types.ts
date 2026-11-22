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
  label: string;
}

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

export interface Plan {
  people: [Person, Person];
  shared: {
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
  kind: "move_in" | "purchase" | "career_break";
  label: string;
  person: string | null;
  end?: Month;
}

export type SeriesKey =
  | "cash" | "investments" | "net_worth" | "income" | "tax" | "spending" | "household"
  | "housing" | "amortization" | "one_off" | "deposit" | "net_flow" | "property_value" | "mortgage";

export interface Evaluation {
  status: "on_track" | "attention" | "conflict";
  months: Month[];
  people: [PersonResult, PersonResult];
  issues: Issue[];
  property: PropertyResult | null;
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
