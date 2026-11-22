"use client";

import { ArrowLeft, ChevronDown, Loader2, Lock, Pencil, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { scopedHref, useStore } from "@/lib/store";
import type { ComparisonColumn, DecisionComparison, DecisionQuestion, DecisionState, DecisionUserOption } from "@/lib/types";
import { StressButton, StressTag } from "../Decisions";
import { Button, Skeleton, clsx } from "../ui";
import { DecisionBrief } from "./DecisionBrief";
import { OptionCards } from "./OptionCards";
import { OptionDetail } from "./OptionDetail";
import { OptionsChart, type Metric } from "./OptionsChart";
import { Preferences } from "./Preferences";
import { QuestionInput } from "./QuestionInput";
import { DecisionIcon, KIND_LABEL, appliesFor, optionStyles } from "./registry";

function StatusBadge({ state }: { state: DecisionState }) {
  const map = {
    not_started: ["Exploring · not in your plan", "bg-sunken text-ink-2"],
    in_progress: [state.active ? "Changing your agreed plan · draft" : "Exploring · not in your plan", "bg-sunken text-ink-2"],
    proposed: ["Proposed · waiting for approval", "bg-warn-soft text-warn"],
    in_plan: ["Agreed · in your plan", "bg-good-soft text-good"],
  } as const;
  const [text, cls] = map[state.status];
  return <span className={clsx("inline-flex items-center rounded-full px-2.5 py-1 text-[12.5px] font-medium", cls)}>{text}</span>;
}

/** One essential input. Range inputs commit after a short pause so dragging stays smooth. */
function EssentialField({ q, value, readOnly, onCommit }: {
  q: DecisionQuestion; value: unknown; readOnly: boolean; onCommit: (v: unknown) => void;
}) {
  const [local, setLocal] = useState(value);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div className={clsx("min-w-0", readOnly && "pointer-events-none opacity-75")} aria-disabled={readOnly || undefined}>
      <p className="text-[13.5px] font-medium text-ink">{q.label}</p>
      <div className="mt-1.5">
        <QuestionInput q={q} value={local} onChange={(v) => {
          setLocal(v);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => onCommit(v), q.kind === "share" ? 400 : 0);
        }} />
      </div>
    </div>
  );
}

function Section({ id, title, hint, open, onToggle, children }: {
  id: string; title: string; hint?: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-white shadow-card">
      <button type="button" aria-expanded={open} aria-controls={`section-${id}`} onClick={onToggle}
        className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 sm:px-5">
        <span className="min-w-0">
          <span className="block text-[15.5px] font-semibold text-ink">{title}</span>
          {hint && <span className="block text-[13px] text-muted">{hint}</span>}
        </span>
        <ChevronDown size={18} className={clsx("shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && <div id={`section-${id}`} className="fade-up border-t border-line px-4 py-4 sm:px-5">{children}</div>}
    </section>
  );
}

const SOURCE_TEXT = { answer: "Your answer", plan: "Agreed plan", suggested: "Suggested", assumption: "Assumption", data: "UBS data" } as const;

function DetailRow({ q, onSave }: { q: DecisionQuestion; onSave: (q: DecisionQuestion, v: unknown) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<unknown>(q.value);
  const [busy, setBusy] = useState(false);
  return (
    <li className="py-1">
      <button type="button" onClick={() => { setValue(q.value); setEditing(!editing); }} aria-expanded={editing}
        className="group flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-1 text-left hover:bg-page">
        <span className="min-w-0">
          <span className="block text-[14px] text-ink">{q.label}</span>
          <span className="block text-[12px] text-muted">{q.source ? SOURCE_TEXT[q.source] : ""}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="tnum max-w-[180px] text-right text-[14px] font-medium text-ink">{q.value_text}</span>
          <Pencil size={13} className="text-subtle" aria-hidden />
        </span>
      </button>
      {editing && <div className="fade-up mt-1 mb-2 space-y-3 rounded-xl bg-page p-3">
        {q.help && <p className="text-[13px] leading-5 text-muted">{q.help}</p>}
        <QuestionInput q={q} value={value} onChange={setValue} autoFocus />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={value === undefined || value === null} onClick={async () => {
            setBusy(true);
            const ok = await onSave(q, value);
            setBusy(false);
            if (ok) setEditing(false);
          }}>Save</Button>
        </div>
      </div>}
    </li>
  );
}

function freeOptionId(options: DecisionUserOption[]) {
  for (let n = 1; n < 100; n++) if (!options.some((o) => o.id === `opt-${n}`)) return `opt-${n}`;
  return `opt-${Date.now() % 1000}`;
}

function Planner({ id, viewer, subject }: { id: string; viewer: string; subject: string | null }) {
  const { ws, scope, scopedPerson, stress, toast, refresh, draft, removeChange, openAssistant, name } = useStore();
  const [state, setState] = useState<DecisionState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState("your-plan");
  const [request, setRequest] = useState<{ key: string; data?: DecisionComparison; error?: string }>({ key: "" });
  const [cursor, setCursor] = useState<number | null>(null);
  const [metric, setMetric] = useState<Metric>(scopedPerson ? `cash:${scopedPerson.id}` : "gap");
  const [section, setSection] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    api.decision(id, viewer, ctrl.signal)
      .then(async (s) => {
        if (subject && id === "career-break" && s.questions.find((q) => q.id === "person")?.value !== subject) {
          s = await api.decisionStep(id, { viewer, answers: { person: subject } });
        }
        if (!ctrl.signal.aborted) { setState(s); setLoadError(null); }
      })
      .catch((e) => { if ((e as Error).name !== "AbortError") setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => ctrl.abort();
  }, [id, viewer, ws, subject]);

  const stressKey = JSON.stringify(stress);
  const key = state ? JSON.stringify([id, state.changes, state.options, state.brief.partners, ws?.versions.length, stressKey]) : "";
  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      api.decisionCompare(id, JSON.parse(stressKey), ctrl.signal)
        .then((data) => setRequest({ key, data }))
        .catch((e: Error) => { if (e.name !== "AbortError") setRequest({ key, error: e.message }); });
    }, 120);
    return () => { window.clearTimeout(timer); ctrl.abort(); };
  }, [id, key, stressKey]);

  async function step(body: Parameters<typeof api.decisionStep>[1]) {
    try {
      setState(await api.decisionStep(id, body));
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
      return false;
    }
  }

  async function saveOptions(options: DecisionUserOption[]) {
    try {
      setState(await api.decisionOptions(id, viewer, options));
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
      return false;
    }
  }

  if (loadError) return (
    <div className="mx-auto max-w-md pt-16 text-center">
      <h1 className="text-[19px] font-semibold">This decision isn&apos;t available</h1>
      <p className="mt-2 text-[14px] text-muted">{loadError}</p>
      <Link href={scopedHref("/goals", scope)} className="mt-4 inline-flex min-h-10 items-center text-[14px] font-medium text-accent hover:underline">Back to Goals</Link>
    </div>
  );
  if (!state) return (
    <div className="mx-auto max-w-[1080px] space-y-4 pt-8">
      <Skeleton className="h-8 w-1/3" /><Skeleton className="h-40" /><Skeleton className="h-72" />
    </div>
  );

  const comparison = request.data;
  const fresh = request.key === key;
  const columns = comparison?.columns ?? [];
  const styles = optionStyles(columns);
  const reference = columns[0];
  const sel: ComparisonColumn | undefined = columns.find((c) => c.id === selected) ?? reference;
  const userOption = state.options.find((o) => o.id === selected);
  const editingId = userOption ? userOption.id : sel && (sel.kind === "variant" || sel.kind === "fix") ? sel.id : "your-plan";
  const readOnly = editingId !== "your-plan" && !userOption;
  const byId = Object.fromEntries(state.questions.map((q) => [q.id, q]));
  const base = Object.fromEntries(state.questions.filter((q) => !q.per_partner).map((q) => [q.id, q.value]));
  const overrides = userOption?.answers ?? (readOnly && sel ? sel.overrides : {});
  const values: Record<string, unknown> = { ...base, ...overrides };
  const editingTitle = userOption ? (columns.find((c) => c.id === userOption.id)?.title ?? (userOption.label || "Your option"))
    : readOnly && sel ? sel.title : "Your plan";
  const essentialIds = new Set(state.essentials.flat());
  const details = state.questions.filter((q) => !q.per_partner && q.applies && !essentialIds.has(q.id));
  const userCount = 1 + state.options.length;
  const canAdd = state.options.length < state.max_options;
  const other = ws?.people.find((p) => p.id !== viewer);
  const t = cursor ?? (comparison ? comparison.months.length - 1 : 0);

  async function commit(qid: string, value: unknown) {
    if (readOnly) return;
    if (userOption) {
      await saveOptions(state!.options.map((o) => o.id === userOption.id ? { ...o, answers: { ...o.answers, [qid]: value } } : o));
    } else {
      await step({ viewer, answers: { [qid]: value } });
    }
  }

  async function addOption(from?: ComparisonColumn) {
    if (!canAdd) return;
    const source = from ?? sel;
    const answers = userOption && !from ? { ...userOption.answers }
      : source && source.kind === "variant" ? { ...source.overrides } : {};
    const newId = freeOptionId(state!.options);
    const label = from ? from.title : `Option ${userCount + 1}`;
    if (await saveOptions([...state!.options, { id: newId, label, answers }])) {
      setSelected(newId);
      toast(`${label} added. Change its values above to compare.`, "info");
    }
  }

  async function removeOption(optionId: string) {
    if (await saveOptions(state!.options.filter((o) => o.id !== optionId)) && selected === optionId) setSelected("your-plan");
  }

  async function choose() {
    if (!sel) return;
    setProposing(true);
    try {
      const p = await api.decisionPropose(id, viewer, { option_id: sel.id, stress });
      for (const c of p.changes) if (draft.some((d) => d.path === c.path)) removeChange(c.path);
      setSelected("your-plan");
      await refresh();
      if (p.status === "applied") toast("Applied to your plan");
      else toast(`Sent to ${Object.entries(p.approvals).filter(([, s]) => s === "pending").map(([pid]) => name(pid)).join(" & ")} for approval`, "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setProposing(false);
    }
  }

  async function removeDecision() {
    try {
      const p = await api.decisionPropose(id, viewer, { remove: true });
      await refresh();
      toast(p.status === "applied" ? "Removed from your plan" : `Sent to ${other?.name} for approval`, "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function restart() {
    try {
      setState(await api.decisionRestart(id, viewer));
      setSelected("your-plan");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  const save = (q: DecisionQuestion, value: unknown) => step(q.per_partner ? { viewer, preferences: { [q.id]: value } } : { viewer, answers: { [q.id]: value } });
  const toggle = (s: string) => setSection(section === s ? null : s);
  const prefOpen = state.brief.partners.find((p) => p.id === viewer)?.preferences.filter((p) => p.value === null).length ?? 0;

  return (
    <div className="mx-auto max-w-[1080px] pt-4 sm:pt-6">
      <Link href={scopedHref("/goals", scope)} className="inline-flex min-h-10 items-center gap-1 text-[14px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={15} /> Goals
      </Link>
      <header className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-brand ring-1 ring-line"><DecisionIcon id={state.module.id} size={20} /></span>
          <div className="min-w-0">
            <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] sm:text-[30px]">{state.module.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2"><StatusBadge state={state} />
              {state.updated_at && <span className="text-[13px] text-muted">Last change by {name(state.updated_by)}</span>}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={() => openAssistant({ decision: id })}><Sparkles size={15} /> Ask</Button>
          {state.updated_at && <Button variant="ghost" size="sm" onClick={restart} aria-label="Start over"><RotateCcw size={15} /><span className="hidden sm:inline">Start over</span></Button>}
        </div>
      </header>

      {/* 1. The essentials: at most three groups, editing the selected option. */}
      <section aria-labelledby="essentials" className="mt-5 rounded-2xl border border-line bg-white p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 id="essentials" className="text-[16px] font-semibold tracking-tight">
              {readOnly ? <span className="inline-flex items-center gap-1.5"><Lock size={14} className="text-muted" /> {editingTitle}</span> : <>Editing · {editingTitle}</>}
            </h2>
            <p className="text-[13px] text-muted">
              {readOnly ? `${sel ? KIND_LABEL[sel.kind] : ""}. Make a copy to change it.`
                : "Change a value to see every option update. Converge filled in the rest from your plan."}
            </p>
          </div>
          {readOnly && sel?.kind === "variant" && canAdd && <Button size="sm" variant="secondary" onClick={() => void addOption(sel)}>Edit a copy</Button>}
          {!readOnly && editingId !== "your-plan" && <Button size="sm" variant="ghost" onClick={() => setSelected("your-plan")}>Back to your plan</Button>}
        </div>
        <div className="mt-4 grid gap-x-6 gap-y-5 md:grid-cols-3">
          {state.essentials.map((group, gi) => (
            <div key={gi} className="min-w-0 space-y-4">
              {group.map((qid) => byId[qid]).filter((q) => q && appliesFor(q.id, values, q.applies)).map((q) => (
                <EssentialField key={`${editingId}:${q.id}:${JSON.stringify(values[q.id])}`} q={q} value={values[q.id]} readOnly={readOnly}
                  onCommit={(v) => void commit(q.id, v)} />
              ))}
            </div>
          ))}
        </div>
        {state.errors.map((e) => <p key={e} role="alert" className="mt-3 text-[13.5px] text-bad-strong">{e}</p>)}
        {userOption?.error && <p role="alert" className="mt-3 text-[13.5px] text-bad-strong">{userOption.error}</p>}
      </section>

      {/* 2. Options, the shared timeline and the selected option. */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-[19px] font-semibold tracking-tight">Compare options</h2>
        {!fresh && state.ready && <span role="status" className="flex items-center gap-1.5 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" /> Simulating…</span>}
        <StressTag />
        <StressButton mortgageRate={comparison?.mortgage_rate} />
      </div>
      {!!Object.keys(stress).length && <p className="mt-2 text-[13.5px] text-warn">Stress test on. It only changes this view; a proposal always uses your plan’s own assumptions.</p>}
      {fresh && request.error && <p role="alert" className="mt-3 text-[14px] text-bad-strong">{request.error}</p>}
      {comparison?.notice && <p className="mt-2 text-[14px] text-muted">{comparison.notice}</p>}

      {comparison && sel && reference ? <>
        <div className={clsx("mt-3 transition-opacity", !fresh && "opacity-70")}>
          <OptionCards columns={columns} styles={styles} selected={sel.id} onSelect={setSelected}
            onRemove={(oid) => void removeOption(oid)} onAdd={() => void addOption()} canAdd={canAdd} />
        </div>
        <div className={clsx("mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(340px,1fr)]", !fresh && "opacity-70")}>
          <OptionsChart comparison={comparison} styles={styles} selected={sel.id} onSelect={setSelected} cursor={t} setCursor={setCursor}
            metric={metric} setMetric={setMetric} people={ws?.people ?? []} fixedPerson={scopedPerson?.id ?? null} />
          <OptionDetail state={state} col={sel} reference={reference} otherName={other?.name ?? "your partner"} busy={proposing}
            onChoose={() => void choose()} onCopy={() => void addOption(sel)} canCopy={canAdd && sel.kind === "variant"} />
        </div>
      </> : state.ready && !request.error ? <div className="mt-3 grid gap-3 md:grid-cols-3"><Skeleton className="h-44" /><Skeleton className="h-44" /><Skeleton className="h-44" /></div> : null}

      {/* 3. Progressive detail. */}
      <div className="mt-6 space-y-3">
        <Section id="prefs" title="What matters to you" open={section === "prefs"} onToggle={() => toggle("prefs")}
          hint={prefOpen ? `${prefOpen} personal question${prefOpen === 1 ? "" : "s"} for you · optional` : "Your priorities shape which option fits you best"}>
          <Preferences state={state} onSave={save} />
        </Section>
        <Section id="details" title="Details and assumptions" open={section === "details"} onToggle={() => toggle("details")}
          hint={`${details.length} values · they apply to every option`}>
          <ul className="divide-y divide-line">{details.map((q) => <DetailRow key={`${q.id}:${JSON.stringify(q.value)}`} q={q} onSave={save} />)}</ul>
        </Section>
        <Section id="brief" title="Decision brief" open={section === "brief"} onToggle={() => toggle("brief")} hint="A summary to share, with what is still open and the limits of this projection">
          <DecisionBrief state={state} onSave={save} variant="full" bare />
        </Section>
      </div>
      {state.active && <div className="mt-5"><Button variant="ghost" size="sm" onClick={removeDecision}>Propose removing this decision from your plan</Button></div>}
    </div>
  );
}

export function DecisionPlanner({ id }: { id: string }) {
  const { viewer, ws } = useStore();
  const params = useSearchParams();
  const subject = params.get("subject");
  if (!ws || !viewer) return null;
  // Remount per viewer: each partner sees and states their own preferences.
  return <Planner key={`${id}:${viewer}:${subject}`} id={id} viewer={viewer} subject={subject} />;
}
