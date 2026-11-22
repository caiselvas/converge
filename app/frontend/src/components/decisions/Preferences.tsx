"use client";

import { CircleUserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { scopedHref, useStore } from "@/lib/store";
import type { DecisionQuestion, DecisionState, MemoryHint } from "@/lib/types";
import { Avatar, Button } from "../ui";
import { QuestionInput, currentValue } from "./QuestionInput";

type SaveAnswer = (q: DecisionQuestion, value: unknown) => Promise<boolean>;

/**
 * Each partner's own priorities for this decision. Only the viewer can answer
 * their own; confirmed notes from the assistant profile can be reused, but
 * only when the viewer chooses to.
 */
export function Preferences({ state, onSave }: { state: DecisionState; onSave: SaveAnswer }) {
  const { viewer, name, idx, setViewer, scope } = useStore();
  const [hints, setHints] = useState<MemoryHint[]>([]);
  const mine = state.questions.filter((q) => q.per_partner && q.applies && state.brief.partners.find((p) => p.id === viewer)?.preferences.some((x) => x.id === q.id));
  const other = state.brief.partners.find((p) => p.id !== viewer);

  useEffect(() => {
    const ctrl = new AbortController();
    api.decisionMemory(state.module.id, viewer, ctrl.signal).then((r) => setHints(r.hints)).catch(() => {});
    return () => ctrl.abort();
  }, [state.module.id, viewer]);

  const byQuestion = Object.fromEntries(state.questions.map((q) => [q.id, q]));
  const usable = hints.filter((h) => h.suggestion && h.status === "confirmed");
  const unconfirmed = hints.filter((h) => h.status === "pending");

  return (
    <div className="space-y-5">
      {usable.length > 0 && <div className="rounded-xl bg-accent-soft p-3">
        <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink"><CircleUserRound size={15} /> From your assistant profile</p>
        <ul className="mt-2 space-y-2">
          {usable.map((h) => {
            const s = h.suggestion!;
            const q = byQuestion[s.question_id];
            const already = q && (s.personal ? q.answers?.[viewer]?.value === s.value : q.value === s.value);
            return (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
                <span className="min-w-0">
                  {h.quote ? <q className="text-ink-2">{h.quote}</q> : <span className="text-ink-2">{String(h.value)}</span>}
                  <span className="block text-[12.5px] text-muted">Suggests {s.label}: {s.value_text}</span>
                </span>
                {q && <Button size="sm" variant={already ? "ghost" : "secondary"} disabled={already} onClick={() => void onSave(q, s.value)}>
                  {already ? "In use" : "Use this"}
                </Button>}
              </li>
            );
          })}
        </ul>
      </div>}

      {mine.length > 0 ? <div className="space-y-4">
        {mine.map((q) => (
          <div key={q.id}>
            <p className="text-[14px] font-medium text-ink">{q.prompt}</p>
            <div className="mt-2"><QuestionInput q={q} value={currentValue(q, viewer)} onChange={(v) => void onSave(q, v)} /></div>
          </div>
        ))}
      </div> : <p className="text-[14px] text-muted">There are no personal questions for you in this decision.</p>}

      {unconfirmed.length > 0 && <p className="text-[13px] text-muted">
        The assistant also noted {unconfirmed.length === 1 ? "something" : `${unconfirmed.length} things`} you haven’t confirmed.{" "}
        <Link href={scopedHref("/profile", scope)} className="font-medium text-accent hover:underline">Review in your profile</Link>
      </p>}

      {other && <div className="rounded-xl bg-page p-3 text-[13.5px]">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-semibold text-ink"><Avatar name={other.name} index={idx(other.id)} size={20} /> {other.name}</span>
          {!other.complete && <button type="button" onClick={() => setViewer(other.id)} className="min-h-9 text-[13px] font-medium text-accent hover:underline">Switch to {other.name}</button>}
        </div>
        <ul className="mt-1.5 space-y-1">
          {other.preferences.map((p) => <li key={p.id} className="flex justify-between gap-3">
            <span className="text-muted">{p.topic}</span>
            <span className="text-right text-ink-2">{p.text ?? "Not shared yet"}</span>
          </li>)}
        </ul>
      </div>}
      {state.brief.differences.length > 0 && <div className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">
        {state.brief.differences.map((d) => <p key={d}>{d}</p>)}
      </div>}
      <p className="text-[12.5px] text-muted">Only you can state your own priorities. Converge never infers them from your spending. {name(viewer)}’s answers here never change {other?.name ?? "your partner"}’s.</p>
    </div>
  );
}
