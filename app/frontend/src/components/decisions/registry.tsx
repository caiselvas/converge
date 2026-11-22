import { Baby, Briefcase, Home, KeyRound, Sparkles } from "lucide-react";

import { scopedHref, type Scope } from "@/lib/store";
import type { DecisionStatus } from "@/lib/types";

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
