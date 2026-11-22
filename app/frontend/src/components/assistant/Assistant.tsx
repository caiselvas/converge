"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUp, CircleUserRound, Phone, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { scopedHref, useStore } from "@/lib/store";
import type { Change, DescribedChange, WhatIfResult } from "@/lib/types";
import { voiceApi, type ToolActivity } from "@/lib/voice";
import { ChangeRow } from "../DraftBar";
import { decisionHref } from "../decisions/registry";
import { Avatar, Button, clsx } from "../ui";
import { EvidenceCards, ToolActivityLog } from "./Evidence";

type Turn = {
  speaker: "user" | "assistant";
  text: string;
  source?: "agent" | "parser" | "engine";
  comparisons?: WhatIfResult[];
  changes?: Change[];
  described?: DescribedChange[];
  activity?: ToolActivity[];
  basis?: string;
  link?: { href: string; label: string };
};

type Thread = { session: string | null; turns: Turn[] };
type Status = { agent: "openai" | "openrouter" | "local" | null; voice: boolean; checked: boolean };

const AGENT_NAMES = { openai: "OpenAI", openrouter: "OpenRouter", local: "a local model" } as const;
const DECISION_TITLES: Record<string, string> = {
  "move-in": "Move in together", "buy-home": "Buy a home", "have-child": "Have a child", "career-break": "Career break",
};

const ThreadCtx = createContext<{
  thread: (person: string) => Thread;
  update: (person: string, fn: (t: Thread) => Thread) => void;
  status: Status;
} | null>(null);

/** Keeps each partner's conversation while the panel opens and closes. One assistant for the whole app. */
export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [status, setStatus] = useState<Status>({ agent: null, voice: false, checked: false });
  useEffect(() => {
    let live = true;
    void Promise.allSettled([voiceApi.chatStatus(), voiceApi.status()]).then(([chat, voice]) => {
      if (!live) return;
      setStatus({
        agent: chat.status === "fulfilled" ? chat.value.provider : null,
        voice: voice.status === "fulfilled" && voice.value.enabled,
        checked: true,
      });
    });
    return () => { live = false; };
  }, []);
  const thread = useCallback((person: string) => threads[person] ?? { session: null, turns: [] }, [threads]);
  const update = useCallback((person: string, fn: (t: Thread) => Thread) =>
    setThreads((all) => ({ ...all, [person]: fn(all[person] ?? { session: null, turns: [] }) })), []);
  return <ThreadCtx.Provider value={{ thread, update, status }}>{children}</ThreadCtx.Provider>;
}

function useThreads() {
  const ctx = useContext(ThreadCtx);
  if (!ctx) throw new Error("useThreads outside AssistantProvider");
  return ctx;
}

export function useAssistantStatus() {
  return useThreads().status;
}

function prompts(decision: string | null, names: string[]) {
  const [a, b] = names;
  if (decision === "buy-home") return [`Why does the safest option protect ${b} better?`,
    `Can we still afford this if ${a} takes a career break?`, "What happens if our mortgage rate rises to 3%?"];
  if (decision === "career-break") return ["How much of my pay do I need to keep for the buffer to hold?",
    "Is a Quantitative Finance MSc affordable for us?", "What does a later start change?"];
  if (decision === "have-child") return ["What does childcare cost us in the first years?",
    "Which option keeps both of our buffers safest?", "What if one of us takes more time at home?"];
  if (decision === "move-in") return ["How does each split change our cash buffers?",
    "What rent keeps both of us comfortably safe?", "What changes if we move in six months later?"];
  return ["Can we buy the planned home without either of us falling below our buffer?",
    "I’m considering a master’s. What would it cost us?", "What matters most for our plan right now?"];
}

/** The conversation itself; used in the panel and on the full-page /agent route. */
export function AssistantConversation({ person, decision, initialPrompt, onNavigate, page = false }: {
  person: string; decision: string | null; initialPrompt?: string; onNavigate?: () => void; page?: boolean;
}) {
  const { thread, update, status } = useThreads();
  const { draft, ws, addChanges, refresh, toast, scope, scopedPerson, stress, name, idx } = useStore();
  const router = useRouter();
  const { turns, session } = thread(person);
  const [text, setText] = useState(initialPrompt ?? "");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<ToolActivity[]>([]);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<number[]>([]);
  const request = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const basis = JSON.stringify([draft, ws?.versions[0]?.id]);
  const names = ws?.people.map((p) => p.name) ?? [];

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [turns.length, busy, activity.length]);

  const push = (turn: Turn) => update(person, (t) => ({ ...t, turns: [...t.turns, turn] }));

  async function agentTurn(question: string, controller: AbortController) {
    let sid = session;
    if (!sid) {
      sid = (await voiceApi.startText(person)).session_id;
      update(person, (t) => ({ ...t, session: sid }));
    }
    const tools = new Map<number, ToolActivity>();
    const reply = await voiceApi.chat(sid, question, draft, controller.signal, (entry) => {
      tools.set(entry.id, entry);
      setActivity([...tools.values()]);
    }, decision ?? undefined);
    push({ speaker: "assistant", source: "agent", text: reply.text, comparisons: reply.comparisons, changes: reply.draft_changes,
      activity: [...tools.values()], basis });
  }

  /** Without an AI model: the built-in parser turns clear requests into changes, and the engine answers about the decision. */
  async function parserTurn(question: string) {
    const interpreted = await api.interpret(question, scopedPerson?.id ?? person, draft);
    if (interpreted.decision) {
      if (interpreted.changes.length) {
        await api.decisionStep(interpreted.decision, { viewer: person, adjustments: interpreted.changes });
        await refresh();
      }
      const href = decisionHref(interpreted.decision, interpreted.decision === "career-break" ? scope : "together");
      push({ speaker: "assistant", source: "parser", text: interpreted.changes.length
        ? `I’ve put that into the ${DECISION_TITLES[interpreted.decision] ?? "decision"} planner as a draft. Compare the options there; nothing changes until you both agree.`
        : interpreted.summary || "This belongs in a life-decision planner.", link: { href, label: `Open ${DECISION_TITLES[interpreted.decision] ?? "planner"}` } });
      if (interpreted.decision !== decision) { onNavigate?.(); router.push(href); }
      return;
    }
    if (interpreted.changes.length) {
      push({ speaker: "assistant", source: "parser", text: interpreted.summary || "Here is what I understood:",
        changes: interpreted.changes, described: interpreted.described, basis });
      return;
    }
    if (decision) {
      const comparison = await api.decisionCompare(decision, stress);
      const lines = comparison.columns.map((c) => `${c.title}: ${c.safe ? "passes the safety checks" : c.issue ?? "fails a safety check"}`
        + (c.labels.length ? ` (${c.labels.map((l) => l.text.toLowerCase()).join(", ")})` : "")
        + (c.tradeoff && c.kind !== "yours" ? `. ${c.tradeoff}.` : "."));
      push({ speaker: "assistant", source: "engine", text: "No AI model is connected, so I can’t answer free-form questions. "
        + "Here is what the engine shows for the options on screen:\n\n" + lines.join("\n") });
      return;
    }
    push({ speaker: "assistant", source: "parser", text: interpreted.clarification
      || "No AI model is connected. I can turn clear requests into draft changes, for example “Emil takes 12 months off from Jan 2028” or “buy a CHF 1.2M home in 2028”." });
  }

  async function send(message: string) {
    const question = message.trim();
    if (!question || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setActivity([]);
    setError("");
    setText("");
    push({ speaker: "user", text: question });
    try {
      if (status.agent) await agentTurn(question, controller);
      else await parserTurn(question);
      setActivity([]);
    } catch (problem) {
      if (!controller.signal.aborted) {
        setError(problem instanceof Error ? problem.message : "The turn could not be completed.");
        setText(question);
        update(person, (t) => ({ ...t, turns: t.turns.slice(0, -1) }));
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const mode = !status.checked ? "Checking connection…" : status.agent ? `AI chat · ${AGENT_NAMES[status.agent]} · figures from the engine`
    : ws?.llm_available ? "Quick changes · AI reading, engine figures" : "Quick changes · built-in parser, no AI model";

  return (
    <div className={clsx("flex min-h-0 flex-1 flex-col", page && "min-h-[min(680px,75dvh)] rounded-2xl border border-line bg-white shadow-card")}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 text-[12.5px] text-muted sm:px-5">
        <span className="inline-flex items-center gap-1.5"><Avatar name={name(person)} index={idx(person)} size={18} /> {name(person)}</span>
        <span aria-hidden>·</span>
        <span>{mode}</span>
        {decision && <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">About: {DECISION_TITLES[decision] ?? decision}</span>}
      </div>
      <div ref={log} role="log" aria-live="polite" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5">
        {!turns.length && <div className="py-2">
          <h3 className="text-[18px] font-semibold tracking-tight">{decision ? "Ask about this decision" : "What are you deciding?"}</h3>
          <p className="mt-1 text-[14px] leading-6 text-muted">
            {status.agent ? "Talk it through. Every figure comes from the planning engine, and nothing changes until you both approve."
              : "Describe a change in your own words. Converge reads it, checks it against the plan’s rules and shows it as a draft."}
          </p>
          <div className="mt-4 grid gap-2">
            {prompts(decision, names).map((p) => (
              <button type="button" key={p} disabled={busy || !status.checked} onClick={() => void send(p)}
                className="min-h-11 rounded-xl border border-line bg-page px-3.5 py-2.5 text-left text-[14px] text-ink-2 transition-colors hover:border-line-strong hover:bg-white disabled:opacity-50">{p}</button>
            ))}
          </div>
        </div>}
        {turns.map((turn, i) => (
          <article key={i} className={clsx("rounded-2xl px-3.5 py-3 text-[14.5px] leading-6",
            turn.speaker === "user" ? "ml-auto max-w-[88%] bg-ink text-white" : "max-w-full bg-page text-ink")}>
            {turn.speaker === "assistant" && <p className="mb-1 text-[12px] font-medium text-muted">
              {turn.source === "agent" ? "Assistant · AI" : turn.source === "engine" ? "Assistant · engine results" : "Assistant"}
            </p>}
            <p className="break-words whitespace-pre-wrap">{turn.text}</p>
            {!!turn.activity?.length && <div className="mt-2.5"><ToolActivityLog entries={turn.activity} /></div>}
            {turn.comparisons?.map((c, k) => <div className="mt-3" key={k}><EvidenceCards result={c} /></div>)}
            {!!turn.described?.length && <div className="mt-2 divide-y divide-line rounded-xl bg-white px-3 ring-1 ring-line">
              {turn.described.map((c) => <ChangeRow key={c.path} c={c} />)}
            </div>}
            {!!turn.changes?.length && <Button className="mt-3" size="sm" variant="secondary" disabled={turn.basis !== basis || added.includes(i)}
              onClick={() => { addChanges(turn.changes ?? []); setAdded((a) => [...a, i]); toast("Added to your draft for review", "info"); }}>
              {added.includes(i) ? "Added to your draft" : turn.basis === basis ? "Add to my draft for review" : "Plan changed · ask again"}
            </Button>}
            {turn.link && <Link href={turn.link.href} onClick={onNavigate} className="mt-2 inline-flex min-h-10 items-center text-[14px] font-semibold text-accent hover:underline">{turn.link.label} →</Link>}
          </article>
        ))}
        <ToolActivityLog entries={activity} />
        {busy && <p role="status" className="pulse-soft text-[13.5px] text-muted">Working on it…</p>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send(text); }}
        className="border-t border-line bg-white px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
        {error && <p role="alert" className="mb-2 text-[13px] text-bad-strong">{error}</p>}
        <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-white py-1.5 pr-1.5 pl-3.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
          <textarea aria-label="Message the assistant" placeholder={decision ? "Ask about these options…" : "Ask or describe a change…"}
            maxLength={4000} rows={1} disabled={busy} value={text} autoFocus={!page}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text); }
            }}
            className="max-h-36 min-h-9 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[16px] leading-6 outline-none placeholder:text-subtle sm:text-[14.5px]" />
          <Button type="submit" aria-label="Send" variant="primary" size="icon-sm" className="rounded-full" disabled={!text.trim() || busy}>
            <ArrowUp size={17} />
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px]">
          <Link href={scopedHref("/profile", scope)} onClick={onNavigate} className="inline-flex min-h-9 items-center gap-1.5 font-medium text-ink-2 hover:text-ink">
            <CircleUserRound size={15} /> What the assistant knows about you
          </Link>
          {status.voice && <Link href={scopedHref("/call", scope)} onClick={onNavigate} className="inline-flex min-h-9 items-center gap-1.5 font-medium text-accent hover:underline">
            <Phone size={14} /> Talk instead
          </Link>}
        </div>
      </form>
    </div>
  );
}

/** Side panel on desktop, full screen on phones. */
export function AssistantSheet() {
  const { assistant, closeAssistant, viewer } = useStore();
  const path = usePathname();
  const onPage = path.match(/^\/goals\/([^/]+)/)?.[1] ?? null;
  const decision = assistant.decision ?? onPage;
  return (
    <Dialog.Root open={assistant.open} onOpenChange={(o) => { if (!o) closeAssistant(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[1px]" />
        <Dialog.Content aria-describedby={undefined}
          className="fade-up fixed inset-0 z-50 flex flex-col bg-white focus:outline-none sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[440px] sm:border-l sm:border-line sm:shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-5">
            <Dialog.Title className="flex items-center gap-2 text-[16px] font-semibold"><Sparkles size={17} className="text-accent" /> Assistant</Dialog.Title>
            <Dialog.Close asChild><Button variant="ghost" size="icon-sm" aria-label="Close assistant"><X size={18} /></Button></Dialog.Close>
          </div>
          {viewer && <AssistantConversation key={`${viewer}:${decision}`} person={viewer} decision={decision}
            initialPrompt={assistant.prompt} onNavigate={closeAssistant} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function AssistantButton({ mobile = false }: { mobile?: boolean }) {
  const { openAssistant, assistant } = useStore();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openAssistant(); }
    }
    if (mobile) return;
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobile, openAssistant]);
  if (mobile) return (
    <button type="button" aria-label="Open assistant" aria-expanded={assistant.open} onClick={() => openAssistant()}
      className="pointer-events-auto mb-2 grid h-13 w-13 place-items-center self-end rounded-full bg-ink text-white shadow-[0_8px_24px_rgb(16_24_40/0.25)] md:hidden">
      <Sparkles size={20} />
    </button>
  );
  return (
    <span className="hidden md:contents">
      <Button variant="ghost" size="sm" onClick={() => openAssistant()} aria-expanded={assistant.open}>
        <Sparkles size={16} /> Ask
      </Button>
    </span>
  );
}
