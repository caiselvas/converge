"use client";

import { ArrowLeft, ArrowRight, Check, CornerDownLeft, Loader2, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api, llmProviderLabel } from "@/lib/api";
import { scopedHref, useStore } from "@/lib/store";
import type { DecisionQuestion, DecisionState, DecisionStepIn, DecisionTurn } from "@/lib/types";
import { Avatar, Button, Disclosure, Skeleton, clsx } from "../ui";
import { DecisionBrief, type Save } from "./DecisionBrief";
import { DecisionReview } from "./DecisionReview";
import { QuestionInput, currentValue } from "./QuestionInput";
import { DecisionIcon } from "./registry";

type View = "ask" | "brief" | "review";

const STEPS = ["Your plan", "You two", "Brief", "Compare"] as const;

function StatusBadge({ state }: { state: DecisionState }) {
  const map = {
    not_started: ["Draft · not in your plan", "bg-page text-ink-2 ring-1 ring-line"],
    in_progress: [state.active ? "Changes to your agreed plan · draft" : "Draft · not in your plan", "bg-page text-ink-2 ring-1 ring-line"],
    proposed: ["Proposed · waiting for approval", "bg-warn-soft text-warn"],
    in_plan: ["Agreed · in your plan", "bg-good-soft text-good"],
  } as const;
  const [text, cls] = map[state.status];
  return <span className={clsx("inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium", cls)}>{text}</span>;
}

function Stepper({ current, state, nextStage, go }: { current: number; state: DecisionState; nextStage: string | null; go: (v: View) => void }) {
  const open = (stage: string) => state.questions.some((q) => q.stage === stage && state.pending.includes(q.id));
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-[12.5px]" aria-label="Progress">
      {STEPS.map((label, i) => {
        const done = i < 2 ? !open(i === 0 ? "intention" : "couple") : i === 2 ? current > 2 : false;
        const enabled = i === 2 || (i === 3 && state.ready) || (i < 2 && open(i === 0 ? "intention" : "couple") && nextStage !== null);
        return (
          <li key={label} className="flex items-center gap-1">
            <button type="button" disabled={!enabled} aria-current={current === i ? "step" : undefined}
              onClick={() => go(i < 2 ? "ask" : i === 2 ? "brief" : "review")}
              className={clsx("flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition-colors",
                current === i ? "bg-ink text-white" : done ? "text-ink-2 hover:bg-page" : "text-subtle", !enabled && current !== i && "cursor-default")}>
              <span className={clsx("grid h-4.5 w-4.5 min-w-[18px] place-items-center rounded-full text-[10.5px]",
                current === i ? "bg-white/20" : done ? "bg-good-soft text-good" : "bg-page ring-1 ring-line")}>
                {done && current !== i ? <Check size={11} strokeWidth={3} /> : i + 1}
              </span>
              {label}
            </button>
            {i < STEPS.length - 1 && <span className="h-px w-3 bg-line-strong" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

function TurnFeedback({ turn }: { turn: DecisionTurn }) {
  return (
    <div aria-live="polite" className="mt-3 space-y-1 text-[12.5px]">
      <p className="text-muted">
        {turn.mode === "llm" && turn.provider
          ? `Read by ${llmProviderLabel[turn.provider]}. Every answer is checked against the plan's rules.`
          : "Read by the built-in parser, one answer at a time. No AI model is connected."}
      </p>
      {turn.notice && <p className="text-warn">{turn.notice}</p>}
      {turn.extracted.length > 0 && <p className="text-good">Noted: {turn.extracted.map((e) => `${e.label} ${e.value_text}`).join(" · ")}</p>}
      {turn.ambiguities.map((a) => <p key={a} className="text-warn">{a}</p>)}
      {turn.rejected.map((r) => <p key={r} className="text-muted">Not used: {r}</p>)}
    </div>
  );
}

function QuestionCard({ q, prompt, worded, number, total, busy, onAnswer, onSkip, onText, turn }: {
  q: DecisionQuestion; prompt: string; worded: boolean; number: number; total: number; busy: boolean;
  onAnswer: (value: unknown) => void; onSkip?: () => void; onText: (text: string) => void; turn: DecisionTurn | null;
}) {
  const { viewer, name, idx, ws } = useStore();
  const [value, setValue] = useState<unknown>(currentValue(q, viewer));
  const [text, setText] = useState("");
  const other = ws?.people.find((p) => p.id !== viewer);
  const hint = q.per_partner ? null
    : q.source === "suggested" ? "A suggested starting point. Change it if it doesn't fit."
      : q.source === "data" ? "From your UBS data." : null;
  return (
    <section aria-labelledby="question" className="fade-up rounded-2xl border border-line bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
        <span>Question {number} of {total} · {q.stage === "intention" ? "Your plan" : "You two"}</span>
        {q.per_partner && <span className="inline-flex items-center gap-1.5 rounded-full bg-p0-soft px-2 py-0.5 font-medium text-ink-2">
          <Avatar name={name(viewer)} index={idx(viewer)} size={16} /> Just for you
        </span>}
      </div>
      <h2 id="question" className="mt-2 text-[21px] leading-snug font-semibold tracking-tight text-ink sm:text-[23px]">{prompt}</h2>
      {worded && <p className="mt-1 text-[11.5px] text-subtle">Worded by the assistant · {q.label}</p>}
      {q.help && <p className="mt-2 max-w-xl text-[13.5px] leading-5 text-muted">{q.help}</p>}
      {q.per_partner && other && <p className="mt-2 text-[12.5px] text-muted">Only you can give this answer.</p>}
      <div className="mt-5"><QuestionInput key={q.id} q={q} value={value} onChange={setValue} autoFocus /></div>
      {hint && <p className="mt-2 text-[12px] text-muted">{hint}</p>}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy || value === undefined || value === null} onClick={() => onAnswer(value)}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : null} Continue <ArrowRight size={14} />
        </Button>
        {onSkip && <Button variant="ghost" disabled={busy} onClick={onSkip}>Skip for now</Button>}
      </div>
      <form className="mt-5 border-t border-line pt-4" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onText(text.trim()); setText(""); } }}>
        <label htmlFor="own-words" className="text-[12.5px] font-medium text-ink-2">Or answer in your own words</label>
        <div className="relative mt-1.5">
          <input id="own-words" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} disabled={busy}
            placeholder={q.kind === "month" ? "e.g. spring 2029" : q.kind === "chf" ? "e.g. around 1.2 million" : "Say it however you like"}
            className="h-10 w-full rounded-full border border-line-strong bg-white pr-10 pl-4 text-[14px] outline-none placeholder:text-subtle focus:ring-2 focus:ring-accent/30" />
          <button type="submit" aria-label="Send answer" disabled={busy || !text.trim()}
            className="absolute top-1/2 right-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-white disabled:opacity-30">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <CornerDownLeft size={13} />}
          </button>
        </div>
        {turn && <TurnFeedback turn={turn} />}
      </form>
    </section>
  );
}

function Planner({ id, viewer, subject, review }: { id: string; viewer: string; subject: string | null; review: boolean }) {
  const { ws, scope, stress, toast, refresh, draft, removeChange } = useStore();
  const [state, setState] = useState<DecisionState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(review ? "review" : null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [turn, setTurn] = useState<DecisionTurn | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    api.decision(id, viewer, ctrl.signal)
      .then(async (s) => {
        if (subject && id === "career-break" && s.questions.find((q) => q.id === "person")?.value !== subject) {
          s = await api.decisionStep(id, { viewer, answers: { person: subject } });
        } else if (subject && id === "career-break" && s.pending.includes("person")) {
          s = await api.decisionStep(id, { viewer, answers: { person: subject } });
        }
        if (!ctrl.signal.aborted) { setState(s); setLoadError(null); }
      })
      .catch((e) => { if ((e as Error).name !== "AbortError") setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => ctrl.abort();
  }, [id, viewer, ws, subject]);

  async function send(body: Omit<DecisionStepIn, "viewer">): Promise<boolean> {
    setBusy(true);
    try {
      const s = await api.decisionStep(id, { viewer, ...body });
      setState(s);
      setTurn(s.turn && (body.text || s.turn.notice) ? s.turn : null);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const save: Save = (q, value) => send(q.per_partner ? { preferences: { [q.id]: value } } : { answers: { [q.id]: value } });

  if (loadError) return (
    <div className="mx-auto max-w-md pt-16 text-center">
      <h1 className="text-[18px] font-semibold">This decision isn&apos;t available</h1>
      <p className="mt-2 text-[13px] text-muted">{loadError}</p>
      <Link href={scopedHref("/goals", scope)} className="mt-4 inline-block text-[13.5px] font-medium text-accent hover:underline">Back to Goals</Link>
    </div>
  );
  if (!state) return (
    <div className="mx-auto max-w-[1040px] space-y-4 pt-8">
      <Skeleton className="h-8 w-1/3" /><Skeleton className="h-64" />
    </div>
  );

  const llm = state.llm_available;
  const nextQ = state.questions.find((q) => q.id === state.pending.find((p) => !skipped.includes(p))) ?? null;
  const shown: View = view === "review" && !state.ready || view === "ask" && !nextQ ? "brief" : view ?? (nextQ ? "ask" : "brief");
  const current = shown === "review" ? 3 : shown === "brief" ? 2 : nextQ?.stage === "intention" ? 0 : 1;
  const prompt = nextQ && state.next?.id === nextQ.id ? state.next.prompt : nextQ?.prompt ?? "";
  const worded = !!nextQ && state.next?.id === nextQ.id && state.next.source === "llm";

  async function answer(value: unknown) {
    if (!nextQ) return;
    await send({ ...(nextQ.per_partner ? { preferences: { [nextQ.id]: value } } : { answers: { [nextQ.id]: value } }), ask_next: llm });
    setTurn(null);
  }

  async function propose(remove = false, option_id?: string) {
    try {
      const p = await api.decisionPropose(id, viewer, { remove, option_id, stress: option_id ? stress : undefined });
      for (const c of p.changes) if (draft.some((d) => d.path === c.path)) removeChange(c.path);
      await refresh();
      if (p.status === "applied") toast("Applied to your plan");
      else toast(`Sent to ${Object.entries(p.approvals).filter(([, s]) => s === "pending").map(([pid]) => ws?.people.find((x) => x.id === pid)?.name).join(" & ")} for approval`, "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function restart() {
    try {
      setState(await api.decisionRestart(id, viewer));
      setSkipped([]);
      setView(null);
      setTurn(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  const brief = (variant: "compact" | "full") => <DecisionBrief state={state} onSave={save} variant={variant} />;
  const side = (
    <aside className="min-w-0">
      <div className="hidden lg:sticky lg:top-36 lg:block">{brief("compact")}</div>
      <div className="lg:hidden"><Disclosure label="Your decision brief so far">{brief("compact")}</Disclosure></div>
    </aside>
  );

  return (
    <div className="mx-auto max-w-[1040px] pt-5 sm:pt-7">
      <Link href={scopedHref("/goals", scope)} className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Goals
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-brand ring-1 ring-line"><DecisionIcon id={state.module.id} /></span>
          <div className="min-w-0">
            <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] sm:text-[32px]">{state.module.title}</h1>
            <p className="mt-1 max-w-2xl text-[14px] leading-6 text-muted">{state.module.promise}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge state={state} />
          {state.updated_at && <Button variant="ghost" size="sm" onClick={restart} aria-label="Start over"><RotateCcw size={14} /> <span className="hidden sm:inline">Start over</span></Button>}
        </div>
      </div>
      <div className="mt-5"><Stepper current={current} state={state} nextStage={nextQ?.stage ?? null} go={setView} /></div>

      {shown === "ask" && nextQ && (
        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <QuestionCard key={`${nextQ.id}:${viewer}`} q={nextQ} prompt={prompt} worded={worded}
            number={Math.min(state.progress.total, state.progress.done + 1)} total={state.progress.total} busy={busy} turn={turn}
            onAnswer={answer}
            onSkip={nextQ.per_partner ? () => setSkipped((s) => [...s, nextQ.id]) : undefined}
            onText={(text) => send({ text, focus: nextQ.id, ask_next: true })} />
          {side}
        </div>
      )}

      {shown === "brief" && (
        <div className="mt-5 max-w-[760px] space-y-4">
          {brief("full")}
          <div className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-muted">
              {state.ready ? "Simulate this brief with the Converge engine to see what it means for each of you."
                : state.errors[0] ?? "Answer the open plan questions to simulate this decision."}
            </p>
            <div className="flex shrink-0 gap-2">
              {nextQ && <Button variant="ghost" size="sm" onClick={() => setView("ask")}>Continue questions</Button>}
              <Button variant="primary" size="sm" disabled={!state.ready} onClick={() => setView("review")}>Compare options <ArrowRight size={14} /></Button>
            </div>
          </div>
        </div>
      )}

      {shown === "review" && (
        <div className="mt-5">
          <DecisionReview state={state} onPropose={(option) => propose(false, option)} onRemove={() => propose(true)} onEdit={() => setView("brief")} />
        </div>
      )}
    </div>
  );
}

export function DecisionPlanner({ id }: { id: string }) {
  const { viewer, ws } = useStore();
  const params = useSearchParams();
  const subject = params.get("subject");
  const review = params.get("review") === "1";
  if (!ws || !viewer) return null;
  // Remount per viewer: each partner sees their own open questions and preferences.
  return <Planner key={`${id}:${viewer}:${subject}:${review}`} id={id} viewer={viewer} subject={subject} review={review} />;
}
