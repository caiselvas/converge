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
  sell_investments: { month: Month; amount: number }[];
}

export interface Stress {
  income_drop?: number;
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
  | "cash" | "investments" | "investment_sale" | "net_worth" | "income" | "family_allowance" | "tax" | "spending" | "household"
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
  kind: "manual" | "recommendation" | "assistant" | "restore" | "decision";
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
  decisions: DecisionSummary[];
}

// ---------------------------------------------------------------- life decisions (converge/decisions.py)

export type DecisionId = "move-in" | "buy-home" | "have-child" | "career-break" | (string & {});
export type DecisionStatus = "not_started" | "in_progress" | "proposed" | "in_plan";

export interface DecisionSummary {
  id: DecisionId;
  title: string;
  promise: string;
  status: DecisionStatus;
  headline: string | null;
  progress: { done: number; total: number };
  proposal_id: string | null;
}

export type QuestionKind = "month" | "chf" | "share" | "choice" | "partner" | "number" | "bool" | "text";
export type AnswerSource = "answer" | "plan" | "suggested" | "assumption" | "data";

export interface DecisionQuestion {
  id: string;
  kind: QuestionKind;
  label: string;
  prompt: string;
  stage: "intention" | "couple" | "details";
  group: "decision" | "responsibilities" | "priorities" | "assumptions";
  help: string;
  per_partner: boolean;
  topic: string;
  options: { value: string; label: string; stance: "flexible" | "firm" | null }[];
  min: number | null;
  max: number | null;
  step: number | null;
  unit: string;
  decimals: number;
  applies: boolean;
  // plan questions
  value?: unknown;
  value_text?: string;
  source?: AnswerSource;
  by?: string | null;
  amount_base?: number | null;
  // personal preference questions
  answers?: Record<string, { value: unknown; text: string }>;
}

export interface BriefItem {
  id: string;
  group: DecisionQuestion["group"];
  label: string;
  value_text: string;
  source: AnswerSource;
  by: string | null;
}

export interface DecisionBrief {
  title: string;
  summary: string;
  items: BriefItem[];
  partners: {
    id: string;
    name: string;
    summary: string | null;
    complete: boolean;
    preferences: { id: string; topic: string; value: unknown; text: string | null; stance: "flexible" | "firm" | null }[];
  }[];
  flexible: string[];
  firm: string[];
  differences: string[];
  missing: string[];
  uncertain: string[];
  limits: string[];
}

export interface DecisionTurn {
  mode: "llm" | "offline";
  provider?: LlmProvider;
  model?: string;
  extracted: { question_id: string; label: string; value_text: string }[];
  rejected: string[];
  ambiguities: string[];
  notice?: string;
}

export interface DecisionState {
  module: { id: DecisionId; title: string; promise: string };
  status: DecisionStatus;
  active: boolean;
  stage: "intention" | "couple" | "review";
  questions: DecisionQuestion[];
  next: { id: string; prompt: string; source: "llm" | "deterministic" } | null;
  pending: string[];
  ready: boolean;
  progress: { done: number; total: number };
  brief: DecisionBrief;
  changes: Change[];
  described: DescribedChange[];
  approvers: string[];
  errors: string[];
  adjustments: Change[];
  proposal: { id: string; status: Proposal["status"]; approvals: Proposal["approvals"]; author: string; title: string; outdated: boolean } | null;
  updated_at: string | null;
  updated_by: string | null;
  llm_available: boolean;
  turn?: DecisionTurn;
}

export interface DecisionStepIn {
  viewer: string;
  answers?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  adjustments?: Change[];
  text?: string;
  focus?: string;
  ask_next?: boolean;
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
  decision?: DecisionId | null;
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

export interface DecisionComparison {
  months: string[];
  evaluated: number;
  mortgage_rate: number | null;
  columns: {
    id: string;
    title: string;
    primary_lever: string | null;
    raw_changes: Change[];
    safe: boolean;
    issue: string | null;
    net_worth: number[];
    people: {
      id: string;
      name: string;
      safe: boolean;
      min_cash: number;
      min_cash_month: string;
      floor: number;
      cash: number[];
      breaches: number[];
      goals: { name: string; reached_month: string | null; slip_months: number | null }[];
    }[];
    home: { month: string; delay_months: number; in_horizon: boolean } | null;
    robustness: { mortgage: StressLimit | null; income: StressLimit };
    respects: string[];
    asks: string[];
  }[];
}
export type StressLimit = { kind: "unsafe" | "cap" | "threshold"; value: number };
