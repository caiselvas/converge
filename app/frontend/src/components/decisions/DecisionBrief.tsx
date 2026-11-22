"use client";

import { ChevronDown, Pencil } from "lucide-react";
import { useState } from "react";

import { useStore } from "@/lib/store";
import type { AnswerSource, BriefItem, DecisionQuestion, DecisionState } from "@/lib/types";
import { Avatar, Button, clsx } from "../ui";
import { QuestionInput, currentValue } from "./QuestionInput";

const SOURCE: Record<AnswerSource, { label: string; cls: string }> = {
  answer: { label: "Your answer", cls: "text-p0" },
  plan: { label: "Agreed plan", cls: "text-good" },
  suggested: { label: "Suggested", cls: "text-warn" },
  assumption: { label: "Assumption", cls: "text-muted" },
  data: { label: "UBS data", cls: "text-brand" },
};

const GROUPS: { id: BriefItem["group"]; title: string }[] = [
  { id: "decision", title: "The plan" },
  { id: "responsibilities", title: "Who does what" },
  { id: "assumptions", title: "Assumptions" },
];

export type Save = (q: DecisionQuestion, value: unknown) => Promise<boolean>;

function ItemEditor({ q, onSave, onClose }: { q: DecisionQuestion; onSave: Save; onClose: () => void }) {
  const { viewer } = useStore();
  const [value, setValue] = useState(currentValue(q, viewer));
  const [busy, setBusy] = useState(false);
  return (
    <div className="fade-up mt-2 space-y-3 rounded-xl bg-page p-3">
      <p className="text-[13px] text-ink-2">{q.prompt}</p>
      {q.help && <p className="text-[12px] leading-5 text-muted">{q.help}</p>}
      <QuestionInput q={q} value={value} onChange={setValue} autoFocus />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={busy || value === undefined || value === null} onClick={async () => {
          setBusy(true);
          const ok = await onSave(q, value);
          setBusy(false);
          if (ok) onClose();
        }}>Save</Button>
      </div>
    </div>
  );
}

function Row({ item, q, onSave, compact }: { item: BriefItem; q: DecisionQuestion | undefined; onSave: Save; compact?: boolean }) {
  const { name } = useStore();
  const [open, setOpen] = useState(false);
  const src = SOURCE[item.source];
  return (
    <li className="border-b border-line/70 last:border-b-0">
      <button type="button" disabled={!q} onClick={() => setOpen(!open)} aria-expanded={open}
        className="group flex w-full items-start justify-between gap-3 py-2 text-left">
        <span className="min-w-0">
          <span className={clsx("block text-ink-2", compact ? "text-[12.5px]" : "text-[13.5px]")}>{item.label}</span>
          <span className={clsx("block text-[11px]", src.cls)}>
            {item.source === "answer" && item.by ? `${name(item.by)}’s answer` : src.label}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={clsx("tnum text-right font-medium text-ink", compact ? "max-w-[150px] text-[12.5px]" : "max-w-[260px] text-[13.5px]")}>{item.value_text}</span>
          {q && <Pencil size={12} className="text-subtle opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />}
        </span>
      </button>
      {open && q && <ItemEditor q={q} onSave={onSave} onClose={() => setOpen(false)} />}
    </li>
  );
}

function Priorities({ state, onSave, compact }: { state: DecisionState; onSave: Save; compact?: boolean }) {
  const { viewer, idx, setViewer } = useStore();
  const [editing, setEditing] = useState<string | null>(null);
  const questions = state.questions.filter((q) => q.per_partner && q.applies);
  if (!questions.length) return null;
  return (
    <div className="space-y-3">
      {state.brief.partners.map((p) => (
        <div key={p.id} className="text-[12.5px]">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-medium text-ink"><Avatar name={p.name} index={idx(p.id)} size={18} />{p.name}</span>
            {p.id !== viewer && !p.complete && (
              <button type="button" onClick={() => setViewer(p.id)} className="text-[12px] font-medium text-accent hover:underline">Switch to {p.name}</button>
            )}
          </div>
          <ul className="mt-1 space-y-1 pl-[26px]">
            {p.preferences.map((pref) => {
              const q = questions.find((x) => x.id === pref.id);
              const mine = p.id === viewer;
              return (
                <li key={pref.id}>
                  <button type="button" disabled={!mine || !q} onClick={() => setEditing(editing === pref.id ? null : pref.id)}
                    className={clsx("flex w-full items-baseline justify-between gap-2 text-left", mine && "hover:text-ink")}>
                    <span className="text-muted">{pref.topic}</span>
                    <span className={clsx("text-right", pref.text ? "text-ink-2" : "text-subtle", pref.stance === "firm" && "font-medium")}>
                      {pref.text ?? (mine ? "Add your view" : "Not shared yet")}
                    </span>
                  </button>
                  {editing === pref.id && q && mine && <ItemEditor q={q} onSave={onSave} onClose={() => setEditing(null)} />}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {!compact && state.brief.differences.length > 0 && (
        <div className="rounded-xl bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
          {state.brief.differences.map((d) => <p key={d}>{d}</p>)}
        </div>
      )}
      <p className="text-[11.5px] text-subtle">Only you can state your own priorities. Converge never infers them from your spending.</p>
    </div>
  );
}

export function DecisionBrief({ state, onSave, variant = "compact" }: { state: DecisionState; onSave: Save; variant?: "compact" | "full" }) {
  const compact = variant === "compact";
  const [showAssumptions, setShowAssumptions] = useState(!compact);
  const byId = Object.fromEntries(state.questions.map((q) => [q.id, q]));
  const b = state.brief;
  return (
    <div className={clsx("rounded-2xl border border-line bg-white", compact ? "p-4" : "p-5 sm:p-6")}>
      <div className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">Decision brief</div>
      <h3 className={clsx("mt-1 font-semibold tracking-tight text-ink", compact ? "text-[15px]" : "text-[19px]")}>{b.summary}</h3>
      {!compact && <p className="mt-1 text-[13px] text-muted">A living summary of what you&apos;re deciding. Select any line to change it.</p>}

      {GROUPS.map(({ id, title }) => {
        const items = b.items.filter((i) => i.group === id);
        if (!items.length) return null;
        const collapsible = id === "assumptions";
        return (
          <div key={id} className="mt-4">
            {collapsible ? (
              <button type="button" onClick={() => setShowAssumptions(!showAssumptions)} aria-expanded={showAssumptions}
                className="flex w-full items-center justify-between text-[12px] font-semibold text-ink">
                {title} <span className="flex items-center gap-1 font-normal text-muted">{items.length}<ChevronDown size={14} className={clsx("transition-transform", showAssumptions && "rotate-180")} /></span>
              </button>
            ) : <div className="text-[12px] font-semibold text-ink">{title}</div>}
            {(!collapsible || showAssumptions) && (
              <ul className="mt-0.5">{items.map((i) => <Row key={i.id} item={i} q={byId[i.id]} onSave={onSave} compact={compact} />)}</ul>
            )}
          </div>
        );
      })}

      <div className="mt-4">
        <div className="mb-1.5 text-[12px] font-semibold text-ink">What matters to each of you</div>
        <Priorities state={state} onSave={onSave} compact={compact} />
      </div>

      {!compact && (b.flexible.length > 0 || b.firm.length > 0) && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-page p-3">
            <div className="text-[12px] font-semibold text-ink">Fixed points</div>
            {b.firm.length ? <ul className="mt-1 space-y-0.5 text-[12.5px] text-ink-2">{b.firm.map((x) => <li key={x}>{x}</li>)}</ul>
              : <p className="mt-1 text-[12.5px] text-muted">None stated.</p>}
          </div>
          <div className="rounded-xl bg-page p-3">
            <div className="text-[12px] font-semibold text-ink">Open to change</div>
            {b.flexible.length ? <ul className="mt-1 space-y-0.5 text-[12.5px] text-ink-2">{b.flexible.map((x) => <li key={x}>{x}</li>)}</ul>
              : <p className="mt-1 text-[12.5px] text-muted">None stated.</p>}
          </div>
        </div>
      )}

      {(b.missing.length > 0 || state.errors.length > 0) && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="text-[12px] font-semibold text-ink">Still open</div>
          <ul className="mt-1 space-y-0.5 text-[12.5px] text-warn">
            {state.errors.map((e) => <li key={e} className="text-bad-strong">{e}</li>)}
            {b.missing.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </div>
      )}
      {!compact && (
        <div className="mt-4 border-t border-line pt-3 text-[12.5px] leading-5 text-muted">
          <div className="text-[12px] font-semibold text-ink">Limits of this projection</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{b.limits.map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
