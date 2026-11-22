import { Check, Loader2, Wrench, X } from "lucide-react";

import type { ToolActivity } from "@/lib/voice";

const labels: Record<string, string> = {
  education_programs: "Look up programme fees and duration",
  explore_what_if: "Run a what-if simulation",
  simulate_changes: "Simulate plan changes",
  get_summary: "Check cash buffers and goals",
  get_profile: "Read financial profile",
  get_gaps: "Check known goals and open questions",
  compare_paths: "Compare alternative paths",
  list_recommendations: "Test possible adjustments",
  propose_changes: "Prepare changes for review",
  save_memory: "Save profile observations",
};

export function ToolActivityLog({ entries }: { entries: ToolActivity[] }) {
  if (!entries.length) return null;
  return <div className="rounded-lg border border-line bg-white/80 px-3 py-2 text-xs text-muted">
    <p className="flex items-center gap-1.5 font-medium text-ink-2"><Wrench size={13} /> Tool activity</p>
    <ul className="mt-1 space-y-1" aria-live="polite">
      {entries.map((entry) => {
        const Icon = entry.status === "running" ? Loader2 : entry.status === "done" ? Check : X;
        const status = entry.status === "running" ? "Running" : entry.status === "done" ? "Done" : "Couldn’t complete";
        return <li key={entry.id} className="flex flex-wrap items-center gap-x-1.5">
          <Icon size={13} className={entry.status === "running" ? "animate-spin" : entry.status === "done" ? "text-good" : "text-bad-strong"} aria-hidden />
          {labels[entry.name] ?? "Use an agent tool"} <span>· {status}</span>
        </li>;
      })}
    </ul>
  </div>;
}
