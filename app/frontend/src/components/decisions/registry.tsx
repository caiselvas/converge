import { Baby, Briefcase, Home, KeyRound, Sparkles } from "lucide-react";

import { scopedHref, type Scope } from "@/lib/store";
import type { ComparisonColumn, DecisionStatus } from "@/lib/types";

/**
 * Display metadata for decision modules. The modules themselves (questions,
 * validation, mapping to plan changes) live in the backend registry
 * (`converge/decisions.py`); a new module only needs an icon here, and falls
 * back to a generic one without it.
 */
const ICONS: Record<string, (size: number) => React.ReactNode> = {
  "career-break": (size) => <Briefcase size={size} />,
  "move-in": (size) => <KeyRound size={size} />,
  "buy-home": (size) => <Home size={size} />,
  "have-child": (size) => <Baby size={size} />,
};

export function DecisionIcon({ id, size = 19 }: { id: string; size?: number }) {
  return ICONS[id]?.(size) ?? <Sparkles size={size} />;
}

export function decisionHref(id: string, scope: Scope, options: { review?: boolean; subject?: string } = {}) {
  const suffix = (options.review ? "&review=1" : "") + (options.subject ? `&subject=${encodeURIComponent(options.subject)}` : "");
  return scopedHref(`/goals/${id}`, scope, suffix);
}

export const STATUS_LABEL: Record<DecisionStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  proposed: "Waiting for approval",
  in_plan: "In your plan",
};

/**
 * Line style per option. The couple's own options are solid lines; options
 * Converge generated are dashed, so the two are never confused.
 */
export type OptionStyle = { color: string; dash?: string; own: boolean };

// Concrete colours: SVG presentation attributes cannot rely on theme variables.
const OWN_COLORS = ["#101828", "#2f6fe4", "#8b5cf6", "#d9467a"];
const ENGINE_COLORS = ["#0f9b8e", "#c98a0a", "#6b7a90"];

export function optionStyles(columns: ComparisonColumn[]): Record<string, OptionStyle> {
  let own = 0;
  let engine = 0;
  return Object.fromEntries(columns.map((c) => {
    const mine = c.kind === "yours" || c.kind === "option";
    const style = mine ? { color: OWN_COLORS[Math.min(own++, OWN_COLORS.length - 1)], own: true }
      : { color: ENGINE_COLORS[Math.min(engine++, ENGINE_COLORS.length - 1)], dash: "6 4", own: false };
    return [c.id, style];
  }));
}

export const KIND_LABEL: Record<ComparisonColumn["kind"], string> = {
  yours: "Your answers",
  option: "Your option",
  variant: "Converge alternative",
  fix: "Converge fix",
};

/**
 * Whether a question applies for a given set of answers. Mirrors the
 * ``applies`` rules in the backend modules for the inputs shown in the planner,
 * so an option's own answers (not only the couple's plan) decide what is shown.
 */
const APPLIES: Record<string, (v: Record<string, unknown>) => boolean> = {
  custom_share_first: (v) => v.split_mode === "custom",
  extra_leave_months: (v) => v.extra_leave === "first" || v.extra_leave === "second",
  extra_leave_income: (v) => v.extra_leave === "first" || v.extra_leave === "second",
  months: (v) => !v.study_program || v.study_program === "none",
  semester_fee: (v) => !!v.study_program && v.study_program !== "none",
  post_study_delta: (v) => !!v.study_program && v.study_program !== "none",
};

export function appliesFor(qid: string, values: Record<string, unknown>, fallback: boolean): boolean {
  const rule = APPLIES[qid];
  return rule ? rule(values) : fallback;
}
